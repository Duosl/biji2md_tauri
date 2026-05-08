/* ==========================================================================
同步历史记录管理 - 持久化同步结果
========================================================================== */

use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::types::{RecentExportItem, SyncHistoryEntry};

const HISTORY_FILE: &str = "history.json";
const MAX_RECENT_EXPORTS: usize = 5;

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
        recent_exports: Vec<RecentExportItem>,
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
            recent_exports: recent_exports
                .into_iter()
                .rev()
                .take(MAX_RECENT_EXPORTS)
                .collect(),
        };

        self.entries.push(entry);

        // 只保留最近 50 条记录
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

    pub fn get_recent_exports(&self, limit: usize) -> Vec<&RecentExportItem> {
        let mut exports: Vec<&RecentExportItem> = self
            .entries
            .iter()
            .rev()
            .flat_map(|entry| &entry.recent_exports)
            .take(limit)
            .collect();
        exports.truncate(limit);
        exports
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

// 用于收集导出项的临时存储
#[derive(Default)]
pub struct ExportCollector {
    exports: Vec<RecentExportItem>,
}

impl ExportCollector {
    pub fn add(&mut self, note_id: String, title: String, action: String, file_path: String) {
        self.exports.push(RecentExportItem {
            note_id,
            title,
            action,
            file_path,
        });
    }

    pub fn into_vec(self) -> Vec<RecentExportItem> {
        self.exports
    }
}
