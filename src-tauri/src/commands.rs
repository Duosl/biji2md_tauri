use std::{
    collections::HashMap,
    fs,
    path::Path,
    process::Command as StdCommand,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::oneshot;

use crate::{
    cache::CacheManager,
    config::{load_config, save_config, DirExportConfig},
    history::HistoryManager,
    index::IndexManager,
    log::SyncLog,
    state::{AppState, RuntimeState},
    sync::run_sync,
    types::{
        mask_secret, AppSettings, CacheInfo, PlatformInfo, SaveSettingFieldInput,
        SaveSettingsInput, StartSyncRequest, SyncCompletedEvent, SyncLogEvent, SyncOverview,
        SyncSnapshot, SyncStatus, UpdateInfo,
    },
};

const FALLBACK_UPDATE_ENDPOINTS: &[&str] = &[
    "https://github.com/Duosl/biji2md_tauri/releases/latest/download/latest.json",
    "https://kkgithub.com/https://github.com/Duosl/biji2md_tauri/releases/latest/download/latest.json",
];

#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    let os = std::env::consts::OS;
    match os {
        "macos" => PlatformInfo {
            platform: "macos".to_string(),
            title_bar_height: 38,
            has_traffic_lights: true,
            window_controls_position: "left".to_string(),
        },
        "windows" => PlatformInfo {
            platform: "windows".to_string(),
            title_bar_height: 40,
            has_traffic_lights: false,
            window_controls_position: "right".to_string(),
        },
        _ => PlatformInfo {
            platform: "linux".to_string(),
            title_bar_height: 40,
            has_traffic_lights: false,
            window_controls_position: "right".to_string(),
        },
    }
}

#[tauri::command]
pub fn save_token(token: String) -> Result<(), String> {
    let mut config = load_config()?;
    config.token = Some(token.trim().to_string());
    save_config(&config)
}

#[tauri::command]
pub fn clear_token() -> Result<AppSettings, String> {
    let mut config = load_config()?;
    config.token = None;
    save_config(&config)?;
    Ok(to_app_settings(config))
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    let config = load_config()?;
    Ok(to_app_settings(config))
}

#[tauri::command]
pub fn save_settings(input: SaveSettingsInput) -> Result<AppSettings, String> {
    let mut config = load_config()?;
    config.default_output_dir = input
        .default_output_dir
        .filter(|value| !value.trim().is_empty());
    config.last_mode = input.last_mode;

    if let Some(show_sync_tips) = input.show_sync_tips {
        config.show_sync_tips = Some(show_sync_tips);
    }

    save_config(&config)?;
    Ok(to_app_settings(config))
}

// 保存单个设置字段（用于自动保存）
#[tauri::command]
pub fn save_setting_field(input: SaveSettingFieldInput) -> Result<AppSettings, String> {
    let mut config = load_config()?;

    match input.field.as_str() {
        "token" => {
            if let Some(token) = input.value.as_str() {
                config.token = Some(token.trim().to_string());
            }
        }
        "defaultOutputDir" => {
            if let Some(dir) = input.value.as_str() {
                config.default_output_dir = if dir.is_empty() {
                    None
                } else {
                    Some(dir.to_string())
                };
            }
        }
        "showSyncTips" => {
            if let Some(val) = input.value.as_bool() {
                config.show_sync_tips = Some(val);
            }
        }
        _ => return Err(format!("未知字段: {}", input.field)),
    }

    save_config(&config)?;
    Ok(to_app_settings(config))
}

#[tauri::command]
pub async fn select_export_dir(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel();

    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(file_path_to_string));
    });

    rx.await
        .map_err(|error| format!("failed to receive selected directory: {error}"))
}

#[tauri::command]
pub fn get_sync_snapshot(state: State<'_, AppState>) -> Result<SyncSnapshot, String> {
    state
        .inner
        .lock()
        .map(|guard| guard.snapshot.clone())
        .map_err(|_| "failed to lock runtime state".to_string())
}

#[tauri::command]
pub fn cancel_sync(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;

    match &guard.cancel_flag {
        Some(flag) if guard.snapshot.running => {
            flag.store(true, Ordering::Relaxed);
            guard.snapshot.status = SyncStatus::Cancelling;
            guard.snapshot.cancel_requested = true;
            guard.snapshot.current_message = "正在取消同步...".to_string();
            Ok(())
        }
        _ => Err("当前没有正在运行的同步任务。".to_string()),
    }
}

#[tauri::command]
pub async fn start_sync(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartSyncRequest,
) -> Result<(), String> {
    eprintln!("[DEBUG] start_sync called");

    // 原子性地检查和设置运行状态，防止竞态条件
    let (export_dir, mode, token) = {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;

        if guard.snapshot.running {
            eprintln!("[DEBUG] start_sync rejected: already running");
            return Err("已有同步任务正在运行。".to_string());
        }

        // 在持有锁的情况下加载配置并验证
        let config = load_config()?;
        let token = config
            .token
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "缺少 Token。请先保存 Token。".to_string())?;
        let export_dir = request
            .export_dir
            .clone()
            .or(config.default_output_dir.clone())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "缺少导出目录。请先选择导出目录。".to_string())?;
        ensure_export_dir_writable(&export_dir)?;
        let page_size = 100;
        let mode = request
            .sync_mode
            .clone()
            .or(config.last_mode.clone())
            .unwrap_or_else(|| "incremental".to_string());

        // 立即标记为运行中，防止重复启动
        guard.cancel_flag = Some(Arc::new(AtomicBool::new(false)));
        guard.snapshot = SyncSnapshot {
            status: SyncStatus::Running,
            running: true,
            cancel_requested: false,
            mode: Some(mode.clone()),
            export_dir: Some(export_dir.clone()),
            page_size: Some(page_size),
            current_page: None,
            page_notes: None,
            processed_count: 0,
            total_fetched: 0,
            total_expected: None,
            current_message: "准备同步".to_string(),
            index_path: None,
            started_at: Some(crate::sync::now_millis()),
            finished_at: None,
            counters: Default::default(),
        };

        (export_dir, mode, token)
    };

    eprintln!("[DEBUG] start_sync spawning workflow");
    let runtime_state = state.inner.clone();

    // 构建请求对象
    let request = StartSyncRequest {
        export_dir: Some(export_dir.clone()),
        sync_mode: Some(mode.clone()),
        page_size: Some(100),
    };

    // 将所有耗时操作移到异步任务中，避免阻塞命令返回
    tauri::async_runtime::spawn(async move {
        eprintln!("[DEBUG] run_sync_workflow started");
        if let Err(e) = run_sync_workflow(app, runtime_state, request, token).await {
            eprintln!("Sync workflow error: {e}");
        }
        eprintln!("[DEBUG] run_sync_workflow ended");
    });

    Ok(())
}

// 同步工作流：在独立任务中执行所有耗时操作
async fn run_sync_workflow(
    app: AppHandle,
    state: Arc<std::sync::Mutex<RuntimeState>>,
    request: StartSyncRequest,
    token: String,
) -> Result<(), String> {
    let export_dir = request
        .export_dir
        .clone()
        .ok_or_else(|| "缺少导出目录。".to_string())?;
    let mode = request
        .sync_mode
        .clone()
        .unwrap_or_else(|| "incremental".to_string());

    // 发送初始状态更新
    let _ = emit_sync_state(&app, &state);

    // 保存配置
    let _ = save_sync_config(&export_dir, &mode);

    // 执行同步
    run_sync(app, state, request, token).await;

    Ok(())
}

// 辅助函数：发送同步状态
fn emit_sync_state(
    app: &AppHandle,
    state: &Arc<std::sync::Mutex<RuntimeState>>,
) -> Result<(), String> {
    let snapshot = {
        let guard = state
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;
        guard.snapshot.clone()
    };

    app.emit("sync_state", snapshot)
        .map_err(|error| format!("failed to emit sync state: {error}"))
}

// 辅助函数：保存同步配置
fn save_sync_config(export_dir: &str, mode: &str) -> Result<(), String> {
    let mut config = load_config()?;
    config.default_output_dir = Some(export_dir.to_string());
    config.last_mode = Some(mode.to_string());
    save_config(&config)
}

fn ensure_export_dir_writable(export_dir: &str) -> Result<(), String> {
    let path = std::path::Path::new(export_dir);
    fs::create_dir_all(path)
        .map_err(|error| format!("无法创建导出目录 {}: {error}", path.display()))?;

    let probe_path = path.join(format!(".biji2md-write-test-{}.tmp", std::process::id()));
    fs::write(&probe_path, b"ok").map_err(|error| {
        if error.kind() == std::io::ErrorKind::PermissionDenied || error.raw_os_error() == Some(1) {
            format!(
                "无法写入导出目录 {}。macOS 可能没有授予当前目录访问权限，请在设置中重新点击“浏览”选择一次该目录。",
                path.display()
            )
        } else {
            format!("无法写入导出目录 {}: {error}", path.display())
        }
    })?;

    let _ = fs::remove_file(probe_path);
    Ok(())
}

fn file_path_to_string(path: FilePath) -> String {
    match path {
        FilePath::Path(path) => path.display().to_string(),
        FilePath::Url(url) => url.to_string(),
    }
}

#[tauri::command]
pub fn open_export_dir(dir: String) -> Result<(), String> {
    let path = Path::new(&dir);
    if !path.exists() {
        return Err("导出目录不存在".to_string());
    }

    open_export_dir_path(path)
}

pub(crate) fn open_export_dir_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        StdCommand::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("无法打开目录: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        StdCommand::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("无法打开目录: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        StdCommand::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("无法打开目录: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_log_dir() -> Result<(), String> {
    let path = crate::config::user_data_dir()?.join("sync.log");
    if !path.exists() {
        return Err("日志文件不存在，请先运行一次同步。".to_string());
    }

    open_export_dir_path(&path)
}

#[tauri::command]
pub fn get_sync_overview(app: AppHandle) -> Result<SyncOverview, String> {
    let config = load_config()?;

    let user_data =
        crate::config::user_data_dir().map_err(|e| format!("无法解析用户数据目录: {e}"))?;
    let cache_dir =
        crate::config::app_cache_dir(&app).map_err(|e| format!("无法解析应用缓存目录: {e}"))?;

    // 检查配置是否完整
    let has_token = config
        .token
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .is_some();
    let has_export_dir = config
        .default_output_dir
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .is_some();
    let has_config = has_token && has_export_dir;

    if !has_config {
        return Ok(SyncOverview {
            has_config: false,
            ..Default::default()
        });
    }

    // 从 index.json 读取同步时间信息
    let index_info = IndexManager::load(&cache_dir).ok().map(|index| {
        (
            index.get_last_sync_at(),
            index.get_last_full_sync_at(),
            index.index_path().display().to_string(),
        )
    });

    // 从 history.json 读取历史记录
    let history = HistoryManager::load(&user_data).ok();

    let last_summary = history.as_ref().and_then(|h| {
        h.get_last_entry()
            .map(|entry| crate::types::SyncHistoryEntry {
                timestamp: entry.timestamp,
                mode: entry.mode.clone(),
                total: entry.total,
                created: entry.created,
                updated: entry.updated,
                skipped: entry.skipped,
                failed: entry.failed,
                cancelled: entry.cancelled,
            })
    });

    let recent_failed_count = history
        .as_ref()
        .map(|h| h.get_recent_failed_count())
        .unwrap_or(0);

    let (last_sync_at, last_full_sync_at, index_path) = match index_info {
        Some((sync_at, full_sync_at, path)) => (sync_at, full_sync_at, Some(path)),
        None => (None, None, None),
    };

    Ok(SyncOverview {
        last_sync_at,
        last_full_sync_at,
        last_mode: config.last_mode,
        last_summary,
        index_path,
        recent_failed_count,
        has_config,
    })
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let endpoints = update_endpoints();
    eprintln!(
        "[DEBUG] check_update request params: currentVersion={}, os={}, arch={}, endpoints={:?}",
        current_version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        endpoints
    );
    log_update_endpoint_responses(&endpoints).await;

    let updater = app.updater().map_err(|e| {
        eprintln!("[DEBUG] updater not available: {e}");
        format!("updater not available: {e}")
    })?;

    eprintln!("[DEBUG] updater created, checking for updates...");

    match updater.check().await {
        Ok(Some(update)) => {
            let info = UpdateInfo {
                available: true,
                version: Some(update.version.clone()),
                current_version,
                body: update.body.clone(),
                date: update.date.map(|d| d.to_string()),
            };
            eprintln!("[DEBUG] check_update response: {:?}", info);
            Ok(info)
        }
        Ok(None) => {
            let info = UpdateInfo {
                available: false,
                version: None,
                current_version,
                body: None,
                date: None,
            };
            eprintln!("[DEBUG] check_update response: {:?}", info);
            Ok(info)
        }
        Err(e) => {
            eprintln!("[DEBUG] check_update response error: {e}");
            Err(format!("check update failed: {e}"))
        }
    }
}

fn update_endpoints() -> Vec<String> {
    let config = include_str!("../tauri.conf.json");
    let parsed = serde_json::from_str::<serde_json::Value>(config)
        .ok()
        .and_then(|value| {
            value
                .pointer("/plugins/updater/endpoints")
                .and_then(|endpoints| endpoints.as_array())
                .map(|endpoints| {
                    endpoints
                        .iter()
                        .filter_map(|endpoint| endpoint.as_str().map(ToString::to_string))
                        .collect::<Vec<_>>()
                })
        })
        .filter(|endpoints| !endpoints.is_empty());

    parsed.unwrap_or_else(|| {
        FALLBACK_UPDATE_ENDPOINTS
            .iter()
            .map(|endpoint| endpoint.to_string())
            .collect()
    })
}

async fn log_update_endpoint_responses(endpoints: &[String]) {
    let client = reqwest::Client::new();

    for endpoint in endpoints {
        eprintln!("[DEBUG] update endpoint request: method=GET url={endpoint}");

        match client.get(endpoint).send().await {
            Ok(response) => {
                let status = response.status();
                let final_url = response.url().to_string();

                match response.text().await {
                    Ok(body) => {
                        eprintln!(
                            "[DEBUG] update endpoint response: status={} finalUrl={} body={}",
                            status,
                            final_url,
                            truncate_debug_body(&body, 2000)
                        );
                    }
                    Err(e) => {
                        eprintln!(
                            "[DEBUG] update endpoint response read failed: status={} finalUrl={} error={}",
                            status, final_url, e
                        );
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "[DEBUG] update endpoint request failed: url={} error={}",
                    endpoint, e
                );
            }
        }
    }
}

fn truncate_debug_body(body: &str, max_chars: usize) -> String {
    let mut truncated: String = body.chars().take(max_chars).collect();
    if body.chars().count() > max_chars {
        truncated.push_str("...");
    }
    truncated
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app
        .updater()
        .map_err(|e| format!("updater not available: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("check failed: {e}"))?
        .ok_or_else(|| "no update available".to_string())?;

    update
        .download_and_install(|_chunk: usize, _content_length: Option<u64>| {}, || {})
        .await
        .map_err(|e| format!("install failed: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn get_sync_logs(limit: Option<usize>) -> Result<Vec<SyncLogEvent>, String> {
    let data_dir = crate::config::user_data_dir()?;
    let log_manager = SyncLog::open(&data_dir)?;
    log_manager.read_recent(limit.unwrap_or(500))
}

fn to_app_settings(config: crate::config::AppConfig) -> AppSettings {
    let has_token = config
        .token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .is_some();

    let masked = if has_token {
        Some(mask_secret(config.token.as_deref().unwrap_or(""), 6, 4))
    } else {
        None
    };

    AppSettings {
        has_token,
        token: config.token.clone(),
        token_masked: masked,
        default_output_dir: config.default_output_dir,
        default_page_size: config.default_page_size.unwrap_or(100).max(1),
        last_mode: config
            .last_mode
            .unwrap_or_else(|| "incremental".to_string()),
        file_name_pattern: "title".to_string(),
        show_sync_tips: config.show_sync_tips.unwrap_or(true),
    }
}

fn rebuild_cached_note_tree(cache: &CacheManager) -> (Vec<crate::types::Note>, u32) {
    let mut notes_by_id = HashMap::new();
    let mut child_links = Vec::new();
    let mut invalid = 0_u32;

    for raw in cache.iter() {
        let Some(note) = crate::api::note_from_value(raw) else {
            invalid += 1;
            continue;
        };

        if let Some(parent_id) = note.parent_id.clone() {
            child_links.push((note.id.clone(), parent_id));
        }
        notes_by_id.insert(note.id.clone(), note);
    }

    let mut children_by_parent: HashMap<String, Vec<crate::types::Note>> = HashMap::new();
    for (child_id, parent_id) in child_links {
        let Some(mut child) = notes_by_id.remove(&child_id) else {
            continue;
        };

        if let Some(parent) = notes_by_id.get(&parent_id) {
            child.parent_title = Some(parent.title.clone());
            if child.topics.is_empty() {
                child.topics = parent.topics.clone();
            }
        }

        children_by_parent.entry(parent_id).or_default().push(child);
    }

    for (parent_id, children) in children_by_parent {
        if let Some(parent) = notes_by_id.get_mut(&parent_id) {
            parent.sub_note_count = children.len() as u32;
            parent.sub_notes = children;
        } else {
            for child in children {
                notes_by_id.insert(child.id.clone(), child);
            }
        }
    }

    (notes_by_id.into_values().collect(), invalid)
}

fn export_cached_note(
    app: &AppHandle,
    state: &Arc<std::sync::Mutex<RuntimeState>>,
    log_manager: &SyncLog,
    exporter: &mut crate::export::Exporter,
    index: &mut IndexManager,
    counters: &mut crate::types::SyncCounters,
    processed_count: &mut u32,
    total_expected: u32,
    note: &crate::types::Note,
    action: &str,
    failure_prefix: &str,
    progress_prefix: &str,
    log_ts: Option<u64>,
) {
    *processed_count += 1;
    let previous_file_path = index.get_file_path(&note.id);

    match exporter.export_note(note, previous_file_path.as_deref()) {
        Ok(file_name) => {
            index.update_note_entry(note, file_name);
            counters.created += 1;
            let _ = app.emit(
                "sync_item",
                crate::types::SyncItemEvent {
                    page_num: 1,
                    page_index: *processed_count,
                    processed_count: *processed_count,
                    total_expected: Some(total_expected),
                    note_id: note.id.clone(),
                    title: note.title.clone(),
                    action: action.to_string(),
                    file_path: index.get_file_path(&note.id).map(|s| s.to_string()),
                    error: None,
                },
            );
        }
        Err(err) => {
            counters.failed += 1;
            let ts = log_ts.unwrap_or_else(crate::sync::now_millis);
            let _ = log_manager.append(
                ts,
                "error",
                &format!("{failure_prefix} [{}]: {}", note.title, err),
            );
            let _ = app.emit(
                "sync_item",
                crate::types::SyncItemEvent {
                    page_num: 1,
                    page_index: *processed_count,
                    processed_count: *processed_count,
                    total_expected: Some(total_expected),
                    note_id: note.id.clone(),
                    title: note.title.clone(),
                    action: "failed".to_string(),
                    file_path: None,
                    error: Some(err),
                },
            );
        }
    }

    update_snapshot_for_reexport(app, state, |snapshot| {
        snapshot.processed_count = *processed_count;
        snapshot.current_message =
            format!("{progress_prefix}：{}/{}", *processed_count, total_expected);
    });
}

#[tauri::command]
pub fn get_dir_export_config(export_dir: String) -> Result<DirExportConfig, String> {
    crate::config::load_dir_export_config(std::path::Path::new(&export_dir))
}

#[tauri::command]
pub async fn get_cache_info() -> Result<CacheInfo, String> {
    tauri::async_runtime::spawn_blocking(|| match CacheManager::load() {
        Ok(manager) => manager.info(),
        Err(_) => CacheInfo {
            exists: false,
            total_count: 0,
            main_note_count: 0,
            sub_note_count: 0,
            cached_at: None,
            file_size_bytes: None,
        },
    })
    .await
    .map_err(|error| format!("读取缓存信息失败: {error}"))
}

#[tauri::command]
pub async fn reexport_from_cache(
    app: AppHandle,
    state: State<'_, AppState>,
    export_dir: Option<String>,
    structure: Option<String>,
    link_format: Option<String>,
) -> Result<(), String> {
    let (export_dir, cache, cancel_flag, cache_dir) = {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;

        if guard.snapshot.running {
            return Err("已有同步任务正在运行。".to_string());
        }

        let config = load_config()?;
        let export_dir = match export_dir {
            Some(dir) if !dir.trim().is_empty() => dir,
            _ => config
                .default_output_dir
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "缺少导出目录。请先选择导出目录。".to_string())?,
        };
        ensure_export_dir_writable(&export_dir)?;

        let cache = CacheManager::load().map_err(|error| format!("加载缓存失败：{error}"))?;
        if cache.is_empty() {
            return Err("暂无缓存数据。请先完成一次同步。".to_string());
        }

        guard.cancel_flag = Some(Arc::new(AtomicBool::new(false)));
        guard.snapshot = SyncSnapshot {
            status: SyncStatus::Running,
            running: true,
            cancel_requested: false,
            mode: Some("cache_reexport".to_string()),
            export_dir: Some(export_dir.clone()),
            page_size: None,
            current_page: None,
            page_notes: None,
            processed_count: 0,
            total_fetched: 0,
            total_expected: Some(cache.len() as u32),
            current_message: "使用缓存重导出中...".to_string(),
            index_path: None,
            started_at: Some(crate::sync::now_millis()),
            finished_at: None,
            counters: Default::default(),
        };

        (
            export_dir,
            cache,
            guard.cancel_flag.clone().unwrap(),
            crate::config::app_cache_dir(&app).ok(),
        )
    };

    let runtime_state = state.inner.clone();
    let app_clone = app.clone();

    let result = run_reexport(
        app_clone,
        runtime_state,
        export_dir,
        cache,
        cancel_flag,
        cache_dir,
        structure,
        link_format,
    )
    .await;

    if let Ok(mut guard) = state.inner.lock() {
        guard.snapshot.running = false;
        guard.snapshot.cancel_requested = false;
        match &result {
            Ok(c) => {
                guard.snapshot.status = SyncStatus::Completed;
                guard.snapshot.finished_at = Some(crate::sync::now_millis());
                guard.snapshot.counters.total = c.total;
                guard.snapshot.counters.created = c.created;
                guard.snapshot.counters.updated = c.updated;
                guard.snapshot.counters.skipped = c.skipped;
                guard.snapshot.counters.failed = c.failed;
                let _ = app.emit("sync_completed", c);
            }
            Err(e) => {
                guard.snapshot.status = SyncStatus::Failed;
                guard.snapshot.finished_at = Some(crate::sync::now_millis());
                guard.snapshot.current_message = format!("重导出失败：{e}");
            }
        }
    }

    result.map(|_| ())
}

#[tauri::command]
pub async fn reexport_from_cache_safe(
    app: AppHandle,
    state: State<'_, AppState>,
    structure: Option<String>,
    link_format: Option<String>,
) -> Result<(), String> {
    let (export_dir, cache, cancel_flag, cache_dir) = {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;

        if guard.snapshot.running {
            return Err("已有同步任务正在运行。".to_string());
        }

        let config = load_config()?;
        let export_dir = config
            .default_output_dir
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "缺少导出目录。请先选择导出目录。".to_string())?;
        ensure_export_dir_writable(&export_dir)?;

        let cache = CacheManager::load().map_err(|error| format!("加载缓存失败：{error}"))?;
        if cache.is_empty() {
            return Err("暂无缓存数据。请先完成一次同步。".to_string());
        }

        guard.cancel_flag = Some(Arc::new(AtomicBool::new(false)));
        guard.snapshot = SyncSnapshot {
            status: SyncStatus::Running,
            running: true,
            cancel_requested: false,
            mode: Some("cache_reexport_safe".to_string()),
            export_dir: Some(export_dir.clone()),
            page_size: None,
            current_page: None,
            page_notes: None,
            processed_count: 0,
            total_fetched: 0,
            total_expected: Some(cache.len() as u32),
            current_message: "安全重导出中...".to_string(),
            index_path: None,
            started_at: Some(crate::sync::now_millis()),
            finished_at: None,
            counters: Default::default(),
        };

        (
            export_dir,
            cache,
            guard.cancel_flag.clone().unwrap(),
            crate::config::app_cache_dir(&app).ok(),
        )
    };

    let runtime_state = state.inner.clone();
    let app_clone = app.clone();

    let result = run_reexport_safe(
        app_clone,
        runtime_state,
        export_dir,
        cache,
        cancel_flag,
        cache_dir,
        structure,
        link_format,
    )
    .await;

    if let Ok(mut guard) = state.inner.lock() {
        guard.snapshot.running = false;
        guard.snapshot.cancel_requested = false;
        match &result {
            Ok(c) => {
                guard.snapshot.status = SyncStatus::Completed;
                guard.snapshot.finished_at = Some(crate::sync::now_millis());
                guard.snapshot.counters.total = c.total;
                guard.snapshot.counters.created = c.created;
                guard.snapshot.counters.updated = c.updated;
                guard.snapshot.counters.skipped = c.skipped;
                guard.snapshot.counters.failed = c.failed;
                let _ = app.emit("sync_completed", c);
            }
            Err(e) => {
                guard.snapshot.status = SyncStatus::Failed;
                guard.snapshot.finished_at = Some(crate::sync::now_millis());
                guard.snapshot.current_message = format!("安全重导出失败：{e}");
            }
        }
    }

    result.map(|_| ())
}

async fn run_reexport(
    app: AppHandle,
    state: Arc<std::sync::Mutex<RuntimeState>>,
    export_dir: String,
    cache: CacheManager,
    cancel_flag: Arc<AtomicBool>,
    cache_dir: Option<std::path::PathBuf>,
    structure: Option<String>,
    link_format: Option<String>,
) -> Result<SyncCompletedEvent, String> {
    use crate::{
        config::user_data_dir, export::Exporter, index::IndexManager, log::SyncLog,
        types::SyncCounters,
    };

    let index_dir = cache_dir
        .as_ref()
        .cloned()
        .unwrap_or_else(|| std::path::PathBuf::from(&export_dir));

    let dir_config = crate::config::load_dir_export_config(std::path::Path::new(&export_dir))?;
    let effective_structure = structure.unwrap_or_else(|| dir_config.structure);
    let effective_link_format = link_format.unwrap_or_else(|| dir_config.link_format);
    let mut exporter = Exporter::new(
        &export_dir,
        Some(&effective_structure),
        Some(&effective_link_format),
    )?;
    let mut index = IndexManager::load(&index_dir)?;
    let user_data = user_data_dir()?;
    let log_manager = SyncLog::open(&user_data)?;

    let (notes, invalid_count) = rebuild_cached_note_tree(&cache);
    let total = cache.len() as u32;
    let mut counters = SyncCounters::default();
    counters.failed = invalid_count;
    let mut processed_count = invalid_count;
    let is_cancelled = || cancel_flag.load(Ordering::Relaxed);

    let _ = log_manager.append(
        crate::sync::now_millis(),
        "info",
        &format!("开始重导出，共 {} 条缓存笔记", total),
    );

    if invalid_count > 0 {
        let _ = log_manager.append(
            crate::sync::now_millis(),
            "warn",
            &format!("重导出跳过 {} 条无法解析的缓存笔记", invalid_count),
        );
    }

    for (idx, note) in notes.iter().enumerate() {
        if is_cancelled() {
            break;
        }

        export_cached_note(
            &app,
            &state,
            &log_manager,
            &mut exporter,
            &mut index,
            &mut counters,
            &mut processed_count,
            total,
            note,
            "created",
            "重导出失败",
            "重导出进度",
            None,
        );

        for child in &note.sub_notes {
            if is_cancelled() {
                break;
            }
            export_cached_note(
                &app,
                &state,
                &log_manager,
                &mut exporter,
                &mut index,
                &mut counters,
                &mut processed_count,
                total,
                child,
                "sub_created",
                "重导出失败",
                "重导出进度",
                None,
            );
        }

        if idx % 10 == 0 && idx > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    index.save()?;

    let dir_cfg = crate::config::DirExportConfig {
        structure: effective_structure,
        link_format: effective_link_format,
    };
    let _ = crate::config::save_dir_export_config(std::path::Path::new(&export_dir), &dir_cfg);

    let cancelled = is_cancelled();
    let _ = log_manager.append(
        crate::sync::now_millis(),
        if cancelled { "warn" } else { "info" },
        &format!(
            "重导出完成：创建 {}，更新 {}，跳过 {}，失败 {}",
            counters.created, counters.updated, counters.skipped, counters.failed
        ),
    );

    Ok(SyncCompletedEvent {
        total: counters.created + counters.updated,
        created: counters.created,
        updated: counters.updated,
        skipped: counters.skipped,
        failed: counters.failed,
        cancelled,
        index_path: index.index_path().display().to_string(),
    })
}

async fn run_reexport_safe(
    app: AppHandle,
    state: Arc<std::sync::Mutex<RuntimeState>>,
    export_dir: String,
    cache: CacheManager,
    cancel_flag: Arc<AtomicBool>,
    cache_dir: Option<std::path::PathBuf>,
    structure: Option<String>,
    link_format: Option<String>,
) -> Result<SyncCompletedEvent, String> {
    use crate::{
        config::{app_cache_dir, user_data_dir},
        export::Exporter,
        index::IndexManager,
        log::SyncLog,
        types::SyncCounters,
    };

    let temp_root = app_cache_dir(&app)?;
    let ts = crate::sync::now_millis();
    let temp_dir = temp_root.join(format!("reexport-tmp-{ts}"));

    fs::create_dir_all(&temp_dir).map_err(|e| format!("无法创建临时目录：{e}"))?;

    let cleanup_temp = || -> Result<(), String> {
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)
                .map_err(|e| eprintln!("[WARN] 清理临时目录失败（不影响结果）：{e}"))
                .ok();
        }
        Ok(())
    };

    let dir_config = crate::config::load_dir_export_config(std::path::Path::new(&export_dir))?;
    let effective_structure = structure.unwrap_or_else(|| dir_config.structure);
    let effective_link_format = link_format.unwrap_or_else(|| dir_config.link_format);
    let mut exporter = Exporter::new(
        &temp_dir,
        Some(&effective_structure),
        Some(&effective_link_format),
    )?;
    let index_dir = cache_dir
        .as_ref()
        .cloned()
        .unwrap_or_else(|| std::path::PathBuf::from(&export_dir));
    let mut index = IndexManager::load(&index_dir)?;
    let user_data = user_data_dir()?;
    let log_manager = SyncLog::open(&user_data)?;

    let (notes, invalid_count) = rebuild_cached_note_tree(&cache);
    let total = cache.len() as u32;
    let mut counters = SyncCounters::default();
    counters.failed = invalid_count;
    let mut processed_count = invalid_count;
    let is_cancelled = || cancel_flag.load(Ordering::Relaxed);

    let _ = log_manager.append(
        ts,
        "info",
        &format!(
            "安全重导出开始，共 {} 条缓存笔记，临时目录：{}",
            total,
            temp_dir.display()
        ),
    );

    if invalid_count > 0 {
        let _ = log_manager.append(
            ts,
            "warn",
            &format!("安全重导出跳过 {} 条无法解析的缓存笔记", invalid_count),
        );
    }

    for (idx, note) in notes.iter().enumerate() {
        if is_cancelled() {
            let _ = log_manager.append(ts, "warn", "安全重导出已取消，清理临时目录");
            cleanup_temp()?;
            return Ok(SyncCompletedEvent {
                total: counters.created + counters.updated,
                created: counters.created,
                updated: counters.updated,
                skipped: counters.skipped,
                failed: counters.failed,
                cancelled: true,
                index_path: index.index_path().display().to_string(),
            });
        }

        export_cached_note(
            &app,
            &state,
            &log_manager,
            &mut exporter,
            &mut index,
            &mut counters,
            &mut processed_count,
            total,
            note,
            "created",
            "安全重导出失败",
            "安全重导出进度",
            Some(ts),
        );

        for child in &note.sub_notes {
            if is_cancelled() {
                break;
            }
            export_cached_note(
                &app,
                &state,
                &log_manager,
                &mut exporter,
                &mut index,
                &mut counters,
                &mut processed_count,
                total,
                child,
                "sub_created",
                "安全重导出失败",
                "安全重导出进度",
                Some(ts),
            );
        }

        if idx % 10 == 0 && idx > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    index.save()?;

    let _ = log_manager.append(
        ts,
        "info",
        &format!(
            "安全重导出完成：创建 {}，更新 {}，跳过 {}，失败 {}。开始替换原目录...",
            counters.created, counters.updated, counters.skipped, counters.failed
        ),
    );

    swap_export_dir_contents(
        &temp_dir,
        &std::path::Path::new(&export_dir),
        &log_manager,
        ts,
    )?;

    cleanup_temp()?;

    let dir_cfg = crate::config::DirExportConfig {
        structure: effective_structure,
        link_format: effective_link_format,
    };
    let _ = crate::config::save_dir_export_config(std::path::Path::new(&export_dir), &dir_cfg);

    let _ = log_manager.append(
        ts,
        "info",
        &format!(
            "安全重导出全部完成：创建 {}，跳过 {}，失败 {}",
            counters.created + counters.updated,
            counters.skipped,
            counters.failed
        ),
    );

    Ok(SyncCompletedEvent {
        total: counters.created + counters.updated,
        created: counters.created,
        updated: counters.updated,
        skipped: counters.skipped,
        failed: counters.failed,
        cancelled: false,
        index_path: index.index_path().display().to_string(),
    })
}

fn swap_export_dir_contents(
    temp_dir: &std::path::Path,
    export_dir: &std::path::Path,
    log_manager: &SyncLog,
    ts: u64,
) -> Result<(), String> {
    let _ = log_manager.append(
        ts,
        "info",
        &format!("清空原导出目录内容：{}", export_dir.display()),
    );

    for entry in fs::read_dir(export_dir).map_err(|e| format!("读取导出目录失败：{e}"))? {
        let entry = entry.map_err(|e| format!("读取目录条目失败：{e}"))?;
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("删除子目录失败 {}：{e}", path.display()))?;
        } else {
            fs::remove_file(&path).map_err(|e| format!("删除文件失败 {}：{e}", path.display()))?;
        }
    }

    let _ = log_manager.append(
        ts,
        "info",
        &format!(
            "将临时目录内容移动到导出目录：{} → {}",
            temp_dir.display(),
            export_dir.display()
        ),
    );

    for entry in fs::read_dir(temp_dir).map_err(|e| format!("读取临时目录失败：{e}"))? {
        let entry = entry.map_err(|e| format!("读取目录条目失败：{e}"))?;
        let src = entry.path();
        let dst = export_dir.join(entry.file_name());
        fs::rename(&src, &dst)
            .map_err(|e| format!("移动文件失败 {} → {}：{e}", src.display(), dst.display()))?;
    }

    Ok(())
}

fn update_snapshot_for_reexport<F>(
    app: &AppHandle,
    state: &Arc<std::sync::Mutex<RuntimeState>>,
    updater: F,
) where
    F: FnOnce(&mut crate::types::SyncSnapshot),
{
    if let Ok(mut guard) = state.lock() {
        updater(&mut guard.snapshot);
        let snapshot = guard.snapshot.clone();
        let _ = app.emit("sync_state", &snapshot);
    }
}
