/* ==========================================================================
同步历史记录管理 - 持久化同步结果
========================================================================== */

use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::types::SyncHistoryEntry;

const HISTORY_FILE: &str = "history.json";

pub struct HistoryManager {
    history_path: PathBuf,
    entries: Vec<SyncHistoryEntry>,
}

impl HistoryManager {
    pub fn load(export_dir: impl AsRef<Path>) -> Result<Self, String> {
        let export_dir = export_dir.as_ref();
        fs::create_dir_all(export_dir)
            .map_err(|error| format!("failed to create export directory: {error}"))?;

        let history_path = export_dir.join(HISTORY_FILE);
        let entries = if history_path.exists() {
            let content = fs::read_to_string(&history_path)
                .map_err(|error| format!("failed to read history file: {error}"))?;

            serde_json::from_str::<Vec<SyncHistoryEntry>>(&content)
                .map_err(|error| format!("failed to parse history file: {error}"))?
        } else {
            Vec::new()
        };

        Ok(Self {
            history_path,
            entries,
        })
    }

    pub fn add_entry(
        &mut self,
        timestamp: u64,
        mode: &str,
        total: u32,
        created: u32,
        updated: u32,
        skipped: u32,
        failed: u32,
        cancelled: bool,
    ) {
        let entry = SyncHistoryEntry {
            timestamp,
            mode: mode.to_string(),
            total,
            created,
            updated,
            skipped,
            failed,
            cancelled,
        };

        self.entries.push(entry);

        if self.entries.len() > 50 {
            self.entries = self.entries.split_off(self.entries.len() - 50);
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let content = serde_json::to_string_pretty(&self.entries)
            .map_err(|error| format!("failed to serialize history: {error}"))?;

        fs::write(&self.history_path, content)
            .map_err(|error| format!("failed to write history file: {error}"))
    }

    pub fn get_last_entry(&self) -> Option<&SyncHistoryEntry> {
        self.entries.last()
    }

    pub fn get_recent_failed_count(&self) -> u32 {
        self.entries
            .iter()
            .rev()
            .take(1)
            .map(|entry| entry.failed)
            .sum()
    }
}
