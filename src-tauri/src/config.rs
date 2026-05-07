use std::{
    fs,
    path::PathBuf,
};

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
}

pub fn load_config() -> Result<AppConfig, String> {
    let path = config_file_path()?;

    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read app config: {error}"))?;

    serde_json::from_str::<AppConfig>(&raw)
        .map_err(|error| format!("failed to parse app config: {error}"))
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_file_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create app config directory: {error}"))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize app config: {error}"))?;

    fs::write(path, content)
        .map_err(|error| format!("failed to write app config: {error}"))
}

pub fn config_file_path() -> Result<PathBuf, String> {
    let dir = config_dir()
        .ok_or_else(|| "failed to resolve system config directory".to_string())?;

    Ok(dir.join("biji2md").join("config.json"))
}
