use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

use crate::{
    config::{load_config, save_config},
    state::AppState,
    sync::run_sync,
    types::{mask_secret, AppSettings, SaveSettingsInput, StartSyncRequest, SyncSnapshot, SyncStatus},
};

#[tauri::command]
pub fn save_token(token: String) -> Result<(), String> {
    let mut config = load_config()?;
    config.token = Some(token.trim().to_string());
    save_config(&config)
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    let config = load_config()?;
    Ok(to_app_settings(config))
}

#[tauri::command]
pub fn save_settings(input: SaveSettingsInput) -> Result<AppSettings, String> {
    let mut config = load_config()?;
    config.default_output_dir = input.default_output_dir.filter(|value| !value.trim().is_empty());
    config.default_page_size = Some(input.default_page_size.unwrap_or(100).max(1));
    config.last_mode = input.last_mode;
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
    let page_size = request.page_size.or(config.default_page_size).unwrap_or(100).max(1);
    let mode = request
        .sync_mode
        .clone()
        .or(config.last_mode.clone())
        .unwrap_or_else(|| "incremental".to_string());

    {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;

        if guard.snapshot.running {
            return Err("已有同步任务正在运行。".to_string());
        }

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
    }

    let request = StartSyncRequest {
        export_dir: Some(export_dir.clone()),
        sync_mode: Some(mode.clone()),
        page_size: Some(page_size),
    };

    let mut updated_config = config;
    updated_config.default_output_dir = Some(export_dir);
    updated_config.default_page_size = Some(page_size);
    updated_config.last_mode = Some(mode);
    save_config(&updated_config)?;

    let runtime_state = state.inner.clone();
    tauri::async_runtime::spawn(run_sync(app.clone(), runtime_state, request, token));
    Ok(())
}

fn file_path_to_string(path: FilePath) -> String {
    match path {
        FilePath::Path(path) => path.display().to_string(),
        FilePath::Url(url) => url.to_string(),
    }
}

fn to_app_settings(config: crate::config::AppConfig) -> AppSettings {
    let masked = config
        .token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| mask_secret(value, 6, 4));

    AppSettings {
        has_token: masked.is_some(),
        token_masked: masked,
        default_output_dir: config.default_output_dir,
        default_page_size: config.default_page_size.unwrap_or(100).max(1),
        last_mode: config
            .last_mode
            .unwrap_or_else(|| "incremental".to_string()),
    }
}
