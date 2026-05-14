use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::types::CacheInfo;

const CACHE_VERSION: &str = "1";

impl Default for NoteCache {
    fn default() -> Self {
        Self {
            version: CACHE_VERSION.to_string(),
            cached_at: 0,
            notes: HashMap::new(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteCache {
    pub version: String,
    pub cached_at: u64,
    pub notes: HashMap<String, serde_json::Value>,
}

pub struct CacheManager {
    cache: NoteCache,
    path: PathBuf,
}

impl Default for CacheManager {
    fn default() -> Self {
        Self {
            cache: NoteCache::default(),
            path: Self::cache_file_path().unwrap_or_else(|_| PathBuf::from("")),
        }
    }
}

impl CacheManager {
    pub fn cache_file_path() -> Result<PathBuf, String> {
        let dir = dirs::config_dir()
            .ok_or_else(|| "failed to resolve system config directory".to_string())?;
        Ok(dir.join("biji2md").join("notes-cache.json"))
    }

    pub fn load() -> Result<Self, String> {
        let path = Self::cache_file_path()?;

        if !path.exists() {
            return Ok(Self {
                cache: NoteCache::default(),
                path,
            });
        }

        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("failed to read cache file: {error}"))?;

        let cache: NoteCache = serde_json::from_str(&raw)
            .map_err(|error| format!("failed to parse cache file: {error}"))?;

        Ok(Self { cache, path })
    }

    pub fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create cache directory: {error}"))?;
        }

        let json = serde_json::to_string_pretty(&self.cache)
            .map_err(|error| format!("failed to serialize cache: {error}"))?;

        fs::write(&self.path, json)
            .map_err(|error| format!("failed to write cache file: {error}"))?;

        Ok(())
    }

    pub fn upsert_raw(&mut self, id: &str, value: serde_json::Value) {
        self.cache.notes.insert(id.to_string(), value);
    }

    pub fn len(&self) -> usize {
        self.cache.notes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cache.notes.is_empty()
    }

    pub fn set_cached_at(&mut self, ts: u64) {
        self.cache.cached_at = ts;
    }

    pub fn iter(&self) -> impl Iterator<Item = &serde_json::Value> {
        self.cache.notes.values()
    }

    pub fn info(&self) -> CacheInfo {
        let (exists, cached_at, total_count) = if self.cache.notes.is_empty() {
            (false, None, 0)
        } else {
            (true, Some(self.cache.cached_at), self.cache.notes.len())
        };

        let file_size_bytes = if exists {
            fs::metadata(&self.path).ok().map(|m| m.len())
        } else {
            None
        };

        CacheInfo {
            exists,
            total_count,
            cached_at,
            file_size_bytes,
        }
    }
}
