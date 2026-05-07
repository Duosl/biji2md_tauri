use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncMode {
    Incremental,
    Full,
}

impl SyncMode {
    pub fn from_str(value: &str) -> Self {
        match value {
            "full" => Self::Full,
            _ => Self::Incremental,
        }
    }

    pub fn from_optional(value: Option<&str>) -> Self {
        value.map(Self::from_str).unwrap_or(Self::Incremental)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Incremental => "incremental",
            Self::Full => "full",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Tag {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Note {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub edit_time: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    #[serde(default = "default_index_version")]
    pub version: String,
    #[serde(default)]
    pub last_note_id: Option<String>,
    #[serde(default)]
    pub last_full_sync_at: Option<u64>,
    #[serde(default)]
    pub last_sync_at: Option<u64>,
    #[serde(default)]
    pub notes: Vec<IndexEntry>,
}

impl Default for Index {
    fn default() -> Self {
        Self {
            version: default_index_version(),
            last_note_id: None,
            last_full_sync_at: None,
            last_sync_at: None,
            notes: Vec::new(),
        }
    }
}

impl Index {
    pub fn get_last_note_id(&self) -> Option<String> {
        self.last_note_id
            .clone()
            .or_else(|| self.notes.last().map(|entry| entry.id.clone()))
    }
}

fn default_index_version() -> String {
    "1".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IndexEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub edit_time: String,
    #[serde(default)]
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSyncRequest {
    #[serde(default)]
    pub export_dir: Option<String>,
    #[serde(default)]
    pub sync_mode: Option<String>,
    #[serde(default)]
    pub page_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsInput {
    #[serde(default)]
    pub default_output_dir: Option<String>,
    #[serde(default)]
    pub default_page_size: Option<u32>,
    #[serde(default)]
    pub last_mode: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    Idle,
    Running,
    Cancelling,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncCounters {
    #[serde(default)]
    pub total: u32,
    #[serde(default)]
    pub created: u32,
    #[serde(default)]
    pub updated: u32,
    #[serde(default)]
    pub skipped: u32,
    #[serde(default)]
    pub failed: u32,
    #[serde(default)]
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub has_token: bool,
    pub token_masked: Option<String>,
    pub default_output_dir: Option<String>,
    pub default_page_size: u32,
    pub last_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSnapshot {
    pub status: SyncStatus,
    pub running: bool,
    pub cancel_requested: bool,
    pub mode: Option<String>,
    pub export_dir: Option<String>,
    pub page_size: Option<u32>,
    pub current_page: Option<u32>,
    pub page_notes: Option<u32>,
    pub processed_count: u32,
    pub total_fetched: u32,
    pub total_expected: Option<u32>,
    pub current_message: String,
    pub index_path: Option<String>,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub counters: SyncCounters,
}

impl Default for SyncSnapshot {
    fn default() -> Self {
        Self {
            status: SyncStatus::Idle,
            running: false,
            cancel_requested: false,
            mode: None,
            export_dir: None,
            page_size: None,
            current_page: None,
            page_notes: None,
            processed_count: 0,
            total_fetched: 0,
            total_expected: None,
            current_message: "等待开始".to_string(),
            index_path: None,
            started_at: None,
            finished_at: None,
            counters: SyncCounters::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLogEvent {
    pub ts: u64,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPageEvent {
    pub page_num: u32,
    pub page_size: u32,
    pub page_notes: u32,
    pub total_fetched: u32,
    pub total_expected: Option<u32>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncItemEvent {
    pub page_num: u32,
    pub page_index: u32,
    pub processed_count: u32,
    pub total_expected: Option<u32>,
    pub note_id: String,
    pub title: String,
    pub action: String,
    pub file_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCompletedEvent {
    pub total: u32,
    pub created: u32,
    pub updated: u32,
    pub skipped: u32,
    pub failed: u32,
    pub cancelled: bool,
    pub index_path: String,
}

pub fn mask_secret(value: &str, visible_start: usize, visible_end: usize) -> String {
    if value.len() <= visible_start + visible_end {
        return "*".repeat(value.len().max(8));
    }

    format!(
        "{}{}{}",
        &value[..visible_start],
        "*".repeat(8),
        &value[value.len() - visible_end..]
    )
}
