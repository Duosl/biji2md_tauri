use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::types::{Index, IndexEntry, Note};

pub struct IndexManager {
    index_path: PathBuf,
    index: Index,
}

impl IndexManager {
    pub fn load(export_dir: impl AsRef<Path>) -> Result<Self, String> {
        let export_dir = export_dir.as_ref();
        fs::create_dir_all(export_dir)
            .map_err(|error| format!("failed to create export directory: {error}"))?;

        let index_path = export_dir.join("index.json");
        let index = if index_path.exists() {
            let content = fs::read_to_string(&index_path)
                .map_err(|error| format!("failed to read index file: {error}"))?;

            serde_json::from_str::<Index>(&content)
                .map_err(|error| format!("failed to parse index file: {error}"))?
        } else {
            Index::default()
        };

        Ok(Self { index_path, index })
    }

    pub fn should_update_note(&self, note: &Note) -> bool {
        match self.index.notes.iter().find(|entry| entry.id == note.id) {
            Some(entry) => entry.edit_time != note.edit_time,
            None => true,
        }
    }

    pub fn has(&self, note_id: &str) -> bool {
        self.index.notes.iter().any(|entry| entry.id == note_id)
    }

    pub fn get_file_path(&self, note_id: &str) -> Option<&str> {
        self.index
            .notes
            .iter()
            .find(|entry| entry.id == note_id)
            .map(|entry| entry.file_path.as_str())
    }

    pub fn update_note_entry(&mut self, note: &Note, file_path: impl Into<String>) {
        let new_entry = IndexEntry {
            id: note.id.clone(),
            edit_time: note.edit_time.clone(),
            file_path: file_path.into(),
        };

        if let Some(entry) = self
            .index
            .notes
            .iter_mut()
            .find(|entry| entry.id == note.id)
        {
            *entry = new_entry;
        } else {
            self.index.notes.push(new_entry);
        }
    }

    pub fn get_last_note_id(&self) -> Option<String> {
        self.index.get_last_note_id()
    }

    pub fn set_last_note_id(&mut self, note_id: Option<String>) {
        self.index.last_note_id = note_id;
    }

    pub fn mark_sync_at(&mut self, timestamp: u64) {
        self.index.last_sync_at = Some(timestamp);
    }

    pub fn mark_full_sync_at(&mut self, timestamp: u64) {
        self.index.last_full_sync_at = Some(timestamp);
    }

    pub fn get_last_sync_at(&self) -> Option<u64> {
        self.index.last_sync_at
    }

    pub fn get_last_full_sync_at(&self) -> Option<u64> {
        self.index.last_full_sync_at
    }

    pub fn save(&self) -> Result<(), String> {
        let content = serde_json::to_string_pretty(&self.index)
            .map_err(|error| format!("failed to serialize index file: {error}"))?;

        fs::write(&self.index_path, content)
            .map_err(|error| format!("failed to write index file: {error}"))
    }

    pub fn index_path(&self) -> &Path {
        &self.index_path
    }
}
