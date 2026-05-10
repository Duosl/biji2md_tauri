use std::{
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
use tokio::sync::oneshot;

use crate::{
    config::{load_config, save_config},
    history::HistoryManager,
    index::IndexManager,
    state::{AppState, RuntimeState},
    sync::run_sync,
    types::{
        mask_secret, AppSettings, PlatformInfo, SaveSettingFieldInput, SaveSettingsInput, StartSyncRequest,
        SyncOverview, SyncSnapshot, SyncStatus,
    },
};

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
    config.default_page_size = Some(input.default_page_size.unwrap_or(100).max(1));
    config.last_mode = input.last_mode;

    // 导出偏好设置
    if let Some(export_structure) = input.export_structure {
        config.export_structure = Some(export_structure);
    }
    if let Some(file_name_pattern) = input.file_name_pattern {
        config.file_name_pattern = Some(file_name_pattern);
    }
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
                config.default_output_dir = if dir.is_empty() { None } else { Some(dir.to_string()) };
            }
        }
        "defaultPageSize" => {
            if let Some(num) = input.value.as_u64() {
                config.default_page_size = Some(num.max(1) as u32);
            }
        }
        "exportStructure" => {
            if let Some(val) = input.value.as_str() {
                config.export_structure = Some(val.to_string());
            }
        }
        "fileNamePattern" => {
            if let Some(val) = input.value.as_str() {
                config.file_name_pattern = Some(val.to_string());
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
    let (export_dir, page_size, mode, token) = {
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
        let page_size = request
            .page_size
            .or(config.default_page_size)
            .unwrap_or(100)
            .max(1);
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

        (export_dir, page_size, mode, token)
    };

    eprintln!("[DEBUG] start_sync spawning workflow");
    let runtime_state = state.inner.clone();

    // 构建请求对象
    let request = StartSyncRequest {
        export_dir: Some(export_dir.clone()),
        sync_mode: Some(mode.clone()),
        page_size: Some(page_size),
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
    let page_size = request.page_size.unwrap_or(100);
    let mode = request
        .sync_mode
        .clone()
        .unwrap_or_else(|| "incremental".to_string());

    // 发送初始状态更新
    let _ = emit_sync_state(&app, &state);

    // 保存配置
    let _ = save_sync_config(&export_dir, page_size, &mode);

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
fn save_sync_config(export_dir: &str, page_size: u32, mode: &str) -> Result<(), String> {
    let mut config = load_config()?;
    config.default_output_dir = Some(export_dir.to_string());
    config.default_page_size = Some(page_size);
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
pub fn get_sync_overview() -> Result<SyncOverview, String> {
    let config = load_config()?;

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

    // 如果没有导出目录，返回空概览
    let export_dir = match config.default_output_dir {
        Some(dir) if !dir.trim().is_empty() => dir,
        _ => {
            return Ok(SyncOverview {
                has_config: false,
                ..Default::default()
            });
        }
    };

    // 从 index.json 读取同步时间信息
    let index_info = IndexManager::load(&export_dir).ok().map(|index| {
        (
            index.get_last_sync_at(),
            index.get_last_full_sync_at(),
            index.index_path().display().to_string(),
        )
    });

    // 从 history.json 读取历史记录
    let history = HistoryManager::load(&export_dir).ok();

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
        // 导出偏好设置（带默认值）
        export_structure: config
            .export_structure
            .unwrap_or_else(|| "by_topic".to_string()),
        file_name_pattern: config
            .file_name_pattern
            .unwrap_or_else(|| "title".to_string()),
        show_sync_tips: config.show_sync_tips.unwrap_or(true),
    }
}
