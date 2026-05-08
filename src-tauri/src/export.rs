use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::types::Note;

#[derive(Clone, Copy)]
enum ExportStructure {
    Flat,
    ByMonth,
    ByTag,
}

#[derive(Clone, Copy)]
enum FileNamePattern {
    TitleId,
    DateTitleId,
}

pub struct Exporter {
    export_dir: PathBuf,
    structure: ExportStructure,
    file_name_pattern: FileNamePattern,
}

impl Exporter {
    pub fn new(
        export_dir: impl AsRef<Path>,
        structure: Option<&str>,
        file_name_pattern: Option<&str>,
    ) -> Result<Self, String> {
        let export_dir = export_dir.as_ref().to_path_buf();
        fs::create_dir_all(&export_dir)
            .map_err(|error| format!("failed to create export directory: {error}"))?;

        Ok(Self {
            export_dir,
            structure: ExportStructure::from_optional(structure),
            file_name_pattern: FileNamePattern::from_optional(file_name_pattern),
        })
    }

    pub fn preview_relative_path(&self, note: &Note) -> String {
        let file_name = note_file_name(note, self.file_name_pattern);
        match self.structure {
            ExportStructure::Flat => file_name,
            ExportStructure::ByMonth => {
                format!("{}/{}", note_month_dir(note), file_name)
            }
            ExportStructure::ByTag => {
                format!("{}/{}", note_tag_dir(note), file_name)
            }
        }
    }

    pub fn export_note(
        &self,
        note: &Note,
        previous_relative_path: Option<&str>,
    ) -> Result<String, String> {
        let relative_path = self.preview_relative_path(note);
        let file_path = self.export_dir.join(&relative_path);
        let content = render_note(note);

        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create markdown parent directory: {error}"))?;
        }

        fs::write(&file_path, content)
            .map_err(|error| format!("failed to write markdown file: {error}"))?;

        if let Some(previous_relative_path) = previous_relative_path {
            if previous_relative_path != relative_path {
                let previous_path = self.export_dir.join(previous_relative_path);
                if previous_path.exists() {
                    fs::remove_file(&previous_path).map_err(|error| {
                        format!("failed to remove stale markdown file: {error}")
                    })?;
                    cleanup_empty_parents(&previous_path, &self.export_dir);
                }
            }
        }

        Ok(relative_path)
    }
}

impl ExportStructure {
    fn from_optional(value: Option<&str>) -> Self {
        match value.unwrap_or("flat") {
            "by_month" => Self::ByMonth,
            "by_tag" => Self::ByTag,
            _ => Self::Flat,
        }
    }
}

impl FileNamePattern {
    fn from_optional(value: Option<&str>) -> Self {
        match value.unwrap_or("title_id") {
            "date_title_id" => Self::DateTitleId,
            _ => Self::TitleId,
        }
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

fn note_file_name(note: &Note, pattern: FileNamePattern) -> String {
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
    match pattern {
        FileNamePattern::TitleId => format!("{stem}__{id}.md"),
        FileNamePattern::DateTitleId => {
            let date = note_date_prefix(note);
            format!("{date}_{stem}__{id}.md")
        }
    }
}

fn note_month_dir(note: &Note) -> String {
    extract_year_month(&note.created_at)
        .or_else(|| extract_year_month(&note.edit_time))
        .unwrap_or_else(|| "unknown-month".to_string())
}

fn note_tag_dir(note: &Note) -> String {
    note.tags
        .iter()
        .map(|tag| sanitize_component(tag.name.trim()))
        .find(|value| !value.is_empty())
        .unwrap_or_else(|| "untagged".to_string())
}

fn note_date_prefix(note: &Note) -> String {
    extract_date(&note.created_at)
        .or_else(|| extract_date(&note.edit_time))
        .unwrap_or_else(|| "unknown-date".to_string())
}

fn extract_year_month(value: &str) -> Option<String> {
    let digits = value
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.len() < 6 {
        return None;
    }

    Some(format!("{}-{}", &digits[0..4], &digits[4..6]))
}

fn extract_date(value: &str) -> Option<String> {
    let digits = value
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.len() < 8 {
        return None;
    }

    Some(format!(
        "{}-{}-{}",
        &digits[0..4],
        &digits[4..6],
        &digits[6..8]
    ))
}

fn cleanup_empty_parents(path: &Path, export_root: &Path) {
    let mut current = path.parent();
    while let Some(dir) = current {
        if dir == export_root {
            break;
        }

        match fs::remove_dir(dir) {
            Ok(()) => current = dir.parent(),
            Err(_) => break,
        }
    }
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
