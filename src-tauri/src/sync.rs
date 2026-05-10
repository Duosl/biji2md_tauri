use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter};
use tokio::time::sleep;

use crate::{
    api::ApiClient,
    commands::open_export_dir_path,
    config::load_config,
    export::Exporter,
    history::HistoryManager,
    index::IndexManager,
    state::RuntimeState,
    types::{
        StartSyncRequest, SyncCompletedEvent, SyncCounters, SyncItemEvent, SyncLogEvent, SyncMode,
        SyncPageEvent, SyncSnapshot, SyncStatus,
    },
};

const DEFAULT_PAGE_SIZE: u32 = 100;

pub async fn run_sync(
    app: AppHandle,
    state: Arc<Mutex<RuntimeState>>,
    request: StartSyncRequest,
    token: String,
) {
    match run_sync_inner(&app, &state, request, token).await {
        Ok(()) => {}
        Err(message) => {
            set_failed(&app, &state, &message);
        }
    }
}

async fn run_sync_inner(
    app: &AppHandle,
    state: &Arc<Mutex<RuntimeState>>,
    request: StartSyncRequest,
    token: String,
) -> Result<(), String> {
    let export_dir = request
        .export_dir
        .clone()
        .ok_or_else(|| "缺少导出目录。请先选择导出目录。".to_string())?;
    let mode = SyncMode::from_optional(request.sync_mode.as_deref());
    let page_size = request.page_size.unwrap_or(DEFAULT_PAGE_SIZE).max(1);

    emit_log(app, "info", &format!("同步模式：{}", mode.as_str()))?;
    emit_log(app, "info", &format!("输出目录：{export_dir}"))?;

    let config = load_config()?;
    let client = ApiClient::new(&token)?;
    let mut index = IndexManager::load(&export_dir)?;
    let exporter = Exporter::new(
        &export_dir,
        config.export_structure.as_deref(),
        config.file_name_pattern.as_deref(),
    )?;
    let open_output_dir_after_sync = config.open_output_dir_after_sync.unwrap_or(false);
    let previous_last_note_id = index.get_last_note_id();

    emit_log(
        app,
        "info",
        &format!(
            "同步起点 last_note_id：{}",
            previous_last_note_id
                .clone()
                .unwrap_or_else(|| "(空，首次同步)".to_string())
        ),
    )?;

    if matches!(mode, SyncMode::Incremental) {
        emit_log(app, "info", "提示：增量模式按时间顺序获取新创建的笔记。")?;
        emit_log(
            app,
            "info",
            "提示：如果历史笔记有编辑，可执行全量同步来获取全量笔记。",
        )?;
    }

    let cancel_flag = current_cancel_flag(state)?;
    let mut cursor = match mode {
        SyncMode::Incremental => previous_last_note_id.clone().unwrap_or_default(),
        SyncMode::Full => String::new(),
    };
    let mut page_num = 1_u32;
    let mut total_expected: Option<u32> = None;
    let mut next_last_note_id = previous_last_note_id;
    let mut can_advance_last_note_id = true;
    let mut counters = SyncCounters::default();
    let mut processed_count = 0_u32;
    let mut cancelled = false;

    loop {
        if is_cancelled(&cancel_flag) {
            cancelled = true;
            break;
        }

        emit_log(
            app,
            "info",
            &format!(
                "[拉取] 第 {page_num} 页开始：since_id={}，limit={page_size}，sort=create_asc",
                if cursor.is_empty() {
                    "(空)"
                } else {
                    cursor.as_str()
                }
            ),
        )?;

        let page = client
            .get_notes_page(
                page_size as usize,
                if cursor.is_empty() {
                    None
                } else {
                    Some(cursor.as_str())
                },
                "create_asc",
            )
            .await?;

        emit_log(
            app,
            "info",
            &format!(
                "[拉取] 第 {page_num} 页完成：{} 条，hasMore={}{}",
                page.notes.len(),
                page.has_more,
                page.total_items
                    .map(|value| format!("，totalItems={value}"))
                    .unwrap_or_default()
            ),
        )?;

        if matches!(mode, SyncMode::Full) && total_expected.is_none() {
            total_expected = page.total_items.and_then(|value| u32::try_from(value).ok());
        }

        if page.notes.is_empty() {
            emit_log(
                app,
                "info",
                &format!("[分页] 第 {page_num} 页没有数据，同步结束。"),
            )?;
            break;
        }

        counters.total += page.notes.len() as u32;
        update_snapshot(state, |snapshot| {
            snapshot.current_page = Some(page_num);
            snapshot.page_notes = Some(page.notes.len() as u32);
            snapshot.total_fetched = counters.total;
            snapshot.total_expected = total_expected;
            snapshot.current_message =
                format!("[分页] 开始处理第 {page_num} 页：{} 条", page.notes.len());
        });
        emit_snapshot(app, state)?;
        emit_page(
            app,
            SyncPageEvent {
                page_num,
                page_size,
                page_notes: page.notes.len() as u32,
                total_fetched: counters.total,
                total_expected,
                has_more: page.has_more,
            },
        )?;

        let mut page_created = 0_u32;
        let mut page_updated = 0_u32;
        let mut page_skipped = 0_u32;
        let mut page_failed = 0_u32;

        for (page_index, note) in page.notes.iter().enumerate() {
            if is_cancelled(&cancel_flag) {
                cancelled = true;
                break;
            }

            processed_count += 1;
            update_snapshot(state, |snapshot| {
                snapshot.processed_count = processed_count;
                snapshot.current_page = Some(page_num);
                snapshot.page_notes = Some(page.notes.len() as u32);
            });

            let previous_file_path = index.get_file_path(&note.id).map(str::to_string);
            let next_file_path = exporter.preview_relative_path(note);
            let needs_export = index.should_update_note(note)
                || previous_file_path.as_deref() != Some(next_file_path.as_str());

            if !needs_export {
                counters.skipped += 1;
                page_skipped += 1;
                if can_advance_last_note_id {
                    next_last_note_id = Some(note.id.clone());
                }
                emit_item(
                    app,
                    SyncItemEvent {
                        page_num,
                        page_index: page_index as u32 + 1,
                        processed_count,
                        total_expected,
                        note_id: note.id.clone(),
                        title: note.title.clone(),
                        action: "skipped".to_string(),
                        file_path: None,
                        error: None,
                    },
                )?;
                continue;
            }

            let action = if index.has(&note.id) {
                "updated"
            } else {
                "created"
            };
            emit_log(
                app,
                "info",
                &format!(
                    "[总进度 {processed_count}{} | 第 {page_num} 页 {}/{}] {}：{}",
                    total_expected
                        .map(|value| format!("/{value}"))
                        .unwrap_or_default(),
                    page_index + 1,
                    page.notes.len(),
                    if action == "created" {
                        "新增导出"
                    } else {
                        "更新导出"
                    },
                    if note.title.trim().is_empty() {
                        note.id.as_str()
                    } else {
                        note.title.as_str()
                    }
                ),
            )?;

            match exporter.export_note(note, previous_file_path.as_deref()) {
                Ok(file_name) => {
                    index.update_note_entry(note, file_name.clone());

                    if action == "created" {
                        counters.created += 1;
                        page_created += 1;
                    } else {
                        counters.updated += 1;
                        page_updated += 1;
                    }

                    if can_advance_last_note_id {
                        next_last_note_id = Some(note.id.clone());
                    }

                    emit_item(
                        app,
                        SyncItemEvent {
                            page_num,
                            page_index: page_index as u32 + 1,
                            processed_count,
                            total_expected,
                            note_id: note.id.clone(),
                            title: note.title.clone(),
                            action: action.to_string(),
                            file_path: Some(file_name),
                            error: None,
                        },
                    )?;
                }
                Err(message) => {
                    counters.failed += 1;
                    page_failed += 1;
                    can_advance_last_note_id = false;
                    emit_log(
                        app,
                        "error",
                        &format!(
                            "[总进度 {processed_count}{} | 第 {page_num} 页 {}/{}] 导出失败：{}（{}）",
                            total_expected
                                .map(|value| format!("/{value}"))
                                .unwrap_or_default(),
                            page_index + 1,
                            page.notes.len(),
                            if note.title.trim().is_empty() {
                                note.id.as_str()
                            } else {
                                note.title.as_str()
                            },
                            message
                        ),
                    )?;
                    emit_item(
                        app,
                        SyncItemEvent {
                            page_num,
                            page_index: page_index as u32 + 1,
                            processed_count,
                            total_expected,
                            note_id: note.id.clone(),
                            title: note.title.clone(),
                            action: "failed".to_string(),
                            file_path: None,
                            error: Some(message),
                        },
                    )?;
                }
            }
        }

        let checkpoint_timestamp = now_millis();
        index.set_last_note_id(next_last_note_id.clone());
        index.mark_sync_at(checkpoint_timestamp);
        if matches!(mode, SyncMode::Full) {
            index.mark_full_sync_at(checkpoint_timestamp);
        }
        index.save()?;

        counters.cancelled = cancelled;
        update_snapshot(state, |snapshot| {
            snapshot.counters = counters.clone();
            snapshot.current_page = Some(page_num);
            snapshot.page_notes = Some(page.notes.len() as u32);
            snapshot.total_fetched = counters.total;
            snapshot.total_expected = total_expected;
            snapshot.processed_count = processed_count;
            snapshot.index_path = Some(index.index_path().display().to_string());
            snapshot.current_message = format!(
                "[分页] 第 {page_num} 页保存完成：新增 {page_created}，更新 {page_updated}，跳过 {page_skipped}，失败 {page_failed}"
            );
        });
        emit_snapshot(app, state)?;
        emit_log(
            app,
            "info",
            &format!(
                "[分页] 第 {page_num} 页保存完成：新增 {page_created}，更新 {page_updated}，跳过 {page_skipped}，失败 {page_failed}；累计新增 {}，累计更新 {}，累计跳过 {}，累计失败 {}",
                counters.created, counters.updated, counters.skipped, counters.failed
            ),
        )?;

        if cancelled {
            break;
        }

        let next_cursor = page.notes.last().map(|note| note.id.clone());
        if !page.has_more || next_cursor.is_none() {
            break;
        }

        let delay = 1000 + (page_num % 3) * 700;
        emit_log(
            app,
            "info",
            &format!(
                "[分页] 第 {page_num} 页完成，等待 {delay}ms 后继续请求第 {} 页...",
                page_num + 1
            ),
        )?;
        sleep(Duration::from_millis(delay as u64)).await;

        cursor = next_cursor.unwrap_or_default();
        page_num += 1;
    }

    let sync_timestamp = now_millis();
    index.set_last_note_id(next_last_note_id);
    index.mark_sync_at(sync_timestamp);
    if matches!(mode, SyncMode::Full) {
        index.mark_full_sync_at(sync_timestamp);
    }
    index.save()?;

    // 保存同步历史记录
    if let Ok(mut history) = HistoryManager::load(&export_dir) {
        history.add_entry(
            sync_timestamp,
            mode.as_str(),
            counters.total,
            counters.created,
            counters.updated,
            counters.skipped,
            counters.failed,
            cancelled,
        );
        let _ = history.save();
    }

    let final_status = if cancelled {
        SyncStatus::Completed
    } else {
        SyncStatus::Completed
    };

    update_snapshot(state, |snapshot| {
        snapshot.status = final_status;
        snapshot.running = false;
        snapshot.cancel_requested = cancelled;
        snapshot.total_fetched = counters.total;
        snapshot.total_expected = total_expected;
        snapshot.processed_count = processed_count;
        snapshot.counters = counters.clone();
        snapshot.current_message = if cancelled {
            "同步已取消。".to_string()
        } else {
            "同步完成。".to_string()
        };
        snapshot.index_path = Some(index.index_path().display().to_string());
        snapshot.finished_at = Some(sync_timestamp);
    });
    clear_cancel_flag(state);
    emit_snapshot(app, state)?;
    emit_completed(
        app,
        SyncCompletedEvent {
            total: counters.total,
            created: counters.created,
            updated: counters.updated,
            skipped: counters.skipped,
            failed: counters.failed,
            cancelled,
            index_path: index.index_path().display().to_string(),
        },
    )?;

    if !cancelled && open_output_dir_after_sync {
        let _ = open_export_dir_path(std::path::Path::new(&export_dir));
    }

    Ok(())
}

fn current_cancel_flag(state: &Arc<Mutex<RuntimeState>>) -> Result<Arc<AtomicBool>, String> {
    let guard = state
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;

    guard
        .cancel_flag
        .clone()
        .ok_or_else(|| "missing cancel flag".to_string())
}

fn clear_cancel_flag(state: &Arc<Mutex<RuntimeState>>) {
    if let Ok(mut guard) = state.lock() {
        guard.cancel_flag = None;
    }
}

fn is_cancelled(flag: &Arc<AtomicBool>) -> bool {
    flag.load(Ordering::Relaxed)
}

fn emit_log(app: &AppHandle, level: &str, message: &str) -> Result<(), String> {
    eprintln!("[DEBUG] emit_log: {}", message);
    app.emit(
        "sync_log",
        SyncLogEvent {
            ts: now_millis(),
            level: level.to_string(),
            message: message.to_string(),
        },
    )
    .map_err(|error| format!("failed to emit sync log: {error}"))
}

fn emit_page(app: &AppHandle, payload: SyncPageEvent) -> Result<(), String> {
    app.emit("sync_page", payload)
        .map_err(|error| format!("failed to emit sync page: {error}"))
}

fn emit_item(app: &AppHandle, payload: SyncItemEvent) -> Result<(), String> {
    app.emit("sync_item", payload)
        .map_err(|error| format!("failed to emit sync item: {error}"))
}

fn emit_completed(app: &AppHandle, payload: SyncCompletedEvent) -> Result<(), String> {
    app.emit("sync_completed", payload)
        .map_err(|error| format!("failed to emit sync completed: {error}"))
}

fn emit_snapshot(app: &AppHandle, state: &Arc<Mutex<RuntimeState>>) -> Result<(), String> {
    let snapshot = {
        let guard = state
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;
        guard.snapshot.clone()
    };

    app.emit("sync_state", snapshot)
        .map_err(|error| format!("failed to emit sync state: {error}"))
}

fn update_snapshot<F>(state: &Arc<Mutex<RuntimeState>>, update: F)
where
    F: FnOnce(&mut SyncSnapshot),
{
    if let Ok(mut guard) = state.lock() {
        update(&mut guard.snapshot);
    }
}

fn set_failed(app: &AppHandle, state: &Arc<Mutex<RuntimeState>>, message: &str) {
    let finished_at = now_millis();

    if let Ok(mut guard) = state.lock() {
        guard.snapshot.status = SyncStatus::Failed;
        guard.snapshot.running = false;
        guard.snapshot.current_message = message.to_string();
        guard.snapshot.finished_at = Some(finished_at);
        guard.cancel_flag = None;
    }

    let _ = emit_log(app, "error", message);
    let _ = emit_snapshot(app, state);
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
