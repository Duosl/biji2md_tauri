use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
};

use crate::types::SyncLogEvent;

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;
const TRIM_KEEP_LINES: usize = 1000;

pub struct SyncLog {
    path: PathBuf,
}

impl SyncLog {
    pub fn open(export_dir: &str) -> Result<Self, String> {
        let path = PathBuf::from(export_dir).join("sync.log");
        let dir = path
            .parent()
            .ok_or_else(|| "invalid export dir".to_string())?;
        fs::create_dir_all(dir)
            .map_err(|e| format!("failed to create log dir: {e}"))?;
        Ok(Self { path })
    }

    pub fn append(&self, ts: u64, level: &str, message: &str) -> Result<(), String> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| format!("failed to open log file: {e}"))?;

        let line = serde_json::json!({
            "ts": ts,
            "level": level,
            "message": message
        });
        writeln!(file, "{line}")
            .map_err(|e| format!("failed to write log: {e}"))?;

        drop(file);
        Ok(())
    }

    pub fn read_recent(&self, limit: usize) -> Result<Vec<SyncLogEvent>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let file = File::open(&self.path)
            .map_err(|e| format!("failed to open log file: {e}"))?;
        let reader = BufReader::new(file);

        let mut all_lines: Vec<String> = reader
            .lines()
            .filter_map(|line| line.ok())
            .filter(|line| !line.trim().is_empty())
            .collect();

        let start = all_lines.len().saturating_sub(limit);
        all_lines = all_lines.split_off(start);

        let entries: Vec<SyncLogEvent> = all_lines
            .iter()
            .filter_map(|line| serde_json::from_str::<SyncLogEvent>(line).ok())
            .map(|mut entry| {
                if entry.level.is_empty() {
                    entry.level = "info".to_string();
                }
                entry
            })
            .collect();

        Ok(entries)
    }

    pub fn trim_if_needed(&self) -> Result<(), String> {
        let size = fs::metadata(&self.path)
            .map(|m| m.len())
            .unwrap_or(0);

        if size <= MAX_FILE_SIZE {
            return Ok(());
        }

        let file = File::open(&self.path)
            .map_err(|e| format!("failed to open log for trim: {e}"))?;
        let reader = BufReader::new(file);

        let all_lines: Vec<String> = reader
            .lines()
            .filter_map(|line| line.ok())
            .filter(|line| !line.trim().is_empty())
            .collect();

        let skip = all_lines.len().saturating_sub(TRIM_KEEP_LINES);
        let retained: Vec<&String> = all_lines.iter().skip(skip).collect();

        let mut file = File::create(&self.path)
            .map_err(|e| format!("failed to rewrite log: {e}"))?;
        for line in &retained {
            writeln!(file, "{line}")
                .map_err(|e| format!("failed to write trimmed log: {e}"))?;
        }

        Ok(())
    }
}
