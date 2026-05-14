use std::{fs, path::Path, path::PathBuf};

use dirs::config_dir;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub token: Option<String>,
    #[serde(default)]
    pub default_output_dir: Option<String>,
    #[serde(default)]
    pub default_page_size: Option<u32>,
    #[serde(default)]
    pub last_mode: Option<String>,
    // 导出偏好设置
    #[serde(default)]
    pub export_structure: Option<String>, // flat, by_month, by_tag, by_topic
    #[serde(default)]
    pub file_name_pattern: Option<String>, // title, date_title_id
    #[serde(default)]
    pub show_sync_tips: Option<bool>,
}

// ~/.biji2md/
pub fn user_data_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".biji2md"))
        .ok_or_else(|| "failed to resolve home directory".to_string())
}

// app_data_dir (Tauri 沙盒)，用于 index 等可重建数据
pub fn app_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))
}

pub(crate) fn migrate_file(src: &Path, dst: &Path) {
    if src.exists() && !dst.exists() {
        if let Some(parent) = dst.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::copy(src, dst);
    }
}

const MIGRATION_FLAG: &str = ".migrated";

pub(crate) fn migrate_once(export_dir: &Path, user_data: &Path, cache_dir: &Path) {
    let flag_path = user_data.join(MIGRATION_FLAG);
    if flag_path.exists() {
        return;
    }
    migrate_file(&export_dir.join("index.json"), &cache_dir.join("index.json"));
    migrate_file(&export_dir.join("history.json"), &user_data.join("history.json"));
    migrate_file(&export_dir.join("sync.log"), &user_data.join("sync.log"));

    let all_migrated = cache_dir.join("index.json").exists()
        && user_data.join("history.json").exists()
        && user_data.join("sync.log").exists();
    if all_migrated {
        let _ = fs::write(
            &flag_path,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                .to_string(),
        );
    }
}

pub fn load_config() -> Result<AppConfig, String> {
    let path = config_file_path()?;

    if !path.exists() {
        if let Some(old_dir) = config_dir() {
            let old_path = old_dir.join("biji2md").join("config.json");
            migrate_file(&old_path, &path);
        }
        if !path.exists() {
            return Ok(AppConfig::default());
        }
    }

    let raw =
        fs::read_to_string(&path).map_err(|error| format!("failed to read app config: {error}"))?;

    serde_json::from_str::<AppConfig>(&raw)
        .map_err(|error| format!("failed to parse app config: {error}"))
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_file_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create app config directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize app config: {error}"))?;

    fs::write(&path, content)
        .map_err(|error| format!("failed to write app config {}: {error}", path.display()))
}

pub fn config_file_path() -> Result<PathBuf, String> {
    let dir = user_data_dir()?;
    Ok(dir.join("config.json"))
}
