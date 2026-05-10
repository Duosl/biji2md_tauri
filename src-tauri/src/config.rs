use std::{fs, path::PathBuf};

use dirs::config_dir;
use serde::{Deserialize, Serialize};

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
    pub file_name_pattern: Option<String>, // title, title_id, date_title_id
    #[serde(default)]
    pub show_sync_tips: Option<bool>,
}

pub fn load_config() -> Result<AppConfig, String> {
    let path = config_file_path()?;

    if !path.exists() {
        return Ok(AppConfig::default());
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
    let dir =
        config_dir().ok_or_else(|| "failed to resolve system config directory".to_string())?;

    Ok(dir.join("biji2md").join("config.json"))
}
