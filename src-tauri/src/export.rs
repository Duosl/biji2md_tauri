use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::types::Note;

pub struct Exporter {
    export_dir: PathBuf,
}

impl Exporter {
    pub fn new(export_dir: impl AsRef<Path>) -> Result<Self, String> {
        let export_dir = export_dir.as_ref().to_path_buf();
        fs::create_dir_all(&export_dir)
            .map_err(|error| format!("failed to create export directory: {error}"))?;

        Ok(Self { export_dir })
    }

    pub fn export_note(&self, note: &Note) -> Result<String, String> {
        let file_name = note_file_name(note);
        let file_path = self.export_dir.join(&file_name);
        let content = render_note(note);

        fs::write(&file_path, content)
            .map_err(|error| format!("failed to write markdown file: {error}"))?;

        Ok(file_name)
    }
}

fn render_note(note: &Note) -> String {
    let tags = note
        .tags
        .iter()
        .map(|tag| yaml_string(&tag.name))
        .collect::<Vec<_>>()
        .join(", ");

    let title = if note.title.trim().is_empty() {
        "未命名"
    } else {
        note.title.trim()
    };

    let normalized_content = note.content.replace("\r\n", "\n");

    format!(
        "---\ntitle: {}\nnote_id: {}\ntags: [{}]\ncreated_at: {}\nupdated_at: {}\n---\n\n{}\n",
        yaml_string(title),
        yaml_string(&note.id),
        tags,
        yaml_string(&note.created_at),
        yaml_string(&note.edit_time),
        normalized_content
    )
}

fn note_file_name(note: &Note) -> String {
    let title = if note.title.trim().is_empty() {
        "未命名"
    } else {
        note.title.trim()
    };

    let mut stem = sanitize_component(title);
    if stem.is_empty() {
        stem = "untitled".to_string();
    }

    let id = sanitize_component(&note.id);
    format!("{stem}__{id}.md")
}

fn sanitize_component(value: &str) -> String {
    let mut cleaned = String::with_capacity(value.len());

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ' ') {
            cleaned.push(ch);
        } else if !ch.is_control()
            && !matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        {
            cleaned.push(ch);
        }
    }

    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(120)
        .collect()
}

fn yaml_string(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
    )
}
