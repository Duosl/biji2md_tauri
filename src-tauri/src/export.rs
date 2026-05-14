use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use crate::types::Note;

#[derive(Clone, Copy)]
enum ExportStructure {
    Flat,
    ByMonth,
    ByTag,
    ByTopic,
}

#[derive(Clone, Copy)]
enum LinkFormat {
    Wikilink,
    Markdown,
}

pub struct Exporter {
    export_dir: PathBuf,
    structure: ExportStructure,
    link_format: LinkFormat,
    used_names: HashSet<String>,
}

impl Exporter {
    pub fn new(
        export_dir: impl AsRef<Path>,
        structure: Option<&str>,
        link_format: Option<&str>,
    ) -> Result<Self, String> {
        let export_dir = export_dir.as_ref().to_path_buf();
        if export_dir.exists() && !export_dir.is_dir() {
            return Err(format!("导出路径不是目录: {}", export_dir.display()));
        }
        match fs::create_dir_all(&export_dir) {
            Ok(()) => {}
            Err(e) => {
                return Err(format!("failed to create export directory: {e}"));
            }
        }

        Ok(Self {
            export_dir,
            structure: ExportStructure::from_optional(structure),
            link_format: LinkFormat::from_optional(link_format),
            used_names: HashSet::new(),
        })
    }

    pub fn preview_relative_path(&self, note: &Note) -> String {
        let file_name = note_file_name(note);
        match self.structure {
            ExportStructure::Flat => file_name,
            ExportStructure::ByMonth => {
                format!("{}/{}", note_month_dir(note), file_name)
            }
            ExportStructure::ByTag => {
                format!("{}/{}", note_tag_dir(note), file_name)
            }
            ExportStructure::ByTopic => {
                format!("{}/{}", note_topic_dir(note), file_name)
            }
        }
    }

    pub fn export_note(
        &mut self,
        note: &Note,
        previous_relative_path: Option<&str>,
    ) -> Result<String, String> {
        let base_path = self.preview_relative_path(note);
        let relative_path = self.resolve_name_conflict(&base_path);
        let file_path = self.export_dir.join(&relative_path);
        let content = self.render_note(note);

        if let Some(parent) = file_path.parent() {
            eprintln!(
                "[DEBUG-EXPORT] export_note create_dir_all: {} (exists={}, is_dir={})",
                parent.display(),
                parent.exists(),
                parent.exists() && parent.is_dir()
            );
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

    fn resolve_name_conflict(&mut self, base_path: &str) -> String {
        if !self.used_names.contains(base_path) {
            self.used_names.insert(base_path.to_string());
            return base_path.to_string();
        }

        let (stem, ext) = base_path.rsplit_once('.').unwrap_or((base_path, ""));
        let mut seq = 2_u32;
        loop {
            let candidate = if ext.is_empty() {
                format!("{stem}_{seq}")
            } else {
                format!("{stem}_{seq}.{ext}")
            };
            if !self.used_names.contains(&candidate) {
                self.used_names.insert(candidate.clone());
                return candidate;
            }
            seq += 1;
        }
    }
}

impl ExportStructure {
    fn from_optional(value: Option<&str>) -> Self {
        match value.unwrap_or("by_topic") {
            "by_month" => Self::ByMonth,
            "by_tag" => Self::ByTag,
            "by_topic" => Self::ByTopic,
            _ => Self::Flat,
        }
    }
}

impl LinkFormat {
    fn from_optional(value: Option<&str>) -> Self {
        match value.unwrap_or(crate::config::DEFAULT_LINK_FORMAT) {
            "markdown" => Self::Markdown,
            _ => Self::Wikilink,
        }
    }
}

impl Exporter {
    pub fn render_note(&self, note: &Note) -> String {
        let tags = note
            .tags
            .iter()
            .map(|tag| yaml_string(&tag.name))
            .collect::<Vec<_>>()
            .join(", ");

        let topics = note
            .topics
            .iter()
            .map(|topic| yaml_string(&topic.topic_name))
            .collect::<Vec<_>>()
            .join(", ");

        let title = if note.title.trim().is_empty() {
            "未命名"
        } else {
            note.title.trim()
        };

        let normalized_content = note.content.replace("\r\n", "\n");

        let mut frontmatter = format!(
            "标题: {}\n笔记ID: {}\n标签: [{}]\n知识库: [{}]\n创建时间: {}\n上次更新时间: {}",
            yaml_string(title),
            yaml_string(&note.id),
            tags,
            topics,
            yaml_string(&note.created_at),
            yaml_string(&note.edit_time)
        );

        if let Some(ref parent_id) = note.parent_id {
            frontmatter.push_str(&format!("\n主笔记ID: {}", yaml_string(parent_id)));
        }

        let mut body = normalized_content;

        if !note.sub_notes.is_empty() {
            body.push_str("\n\n## 子笔记\n");
            for child in &note.sub_notes {
                body.push_str(&format!("- {}\n", self.format_note_link(note, child)));
            }
        }

        if let (Some(ref parent_title), Some(ref parent_id)) = (&note.parent_title, &note.parent_id)
        {
            let parent = Note {
                id: parent_id.clone(),
                title: parent_title.clone(),
                content: String::new(),
                prime_id: None,
                parent_id: None,
                parent_title: None,
                tags: note.tags.clone(),
                topics: note.topics.clone(),
                edit_time: note.edit_time.clone(),
                created_at: note.created_at.clone(),
                sub_note_count: 0,
                sub_notes: Vec::new(),
            };
            body.push_str(&format!(
                "\n\n---\n{}\n",
                self.format_note_link(note, &parent)
            ));
        }

        format!("---\n{frontmatter}\n---\n\n{body}\n")
    }

    fn format_note_link(&self, source: &Note, target: &Note) -> String {
        match self.link_format {
            LinkFormat::Wikilink => format!("[[{}]]", note_file_name(target)),
            LinkFormat::Markdown => {
                let label = markdown_label(if target.title.trim().is_empty() {
                    "未命名"
                } else {
                    target.title.trim()
                });
                let href = relative_markdown_path(
                    &self.preview_relative_path(source),
                    &self.preview_relative_path(target),
                );
                format!("[{label}](<{href}>)")
            }
        }
    }
}

fn note_file_name(note: &Note) -> String {
    let title = if note.title.trim().is_empty() {
        "未命名"
    } else {
        note.title.trim()
    };

    let stem = sanitize_component(title);
    let stem = if stem.is_empty() {
        "untitled".to_string()
    } else {
        stem
    };
    format!("{stem}.md")
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
        .unwrap_or_else(|| "无标签".to_string())
}

fn note_topic_dir(note: &Note) -> String {
    note.topics
        .iter()
        .map(|topic| sanitize_component(topic.topic_name.trim()))
        .find(|value| !value.is_empty())
        .unwrap_or_else(|| "0未加入知识库".to_string())
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

fn relative_markdown_path(source_file: &str, target_file: &str) -> String {
    let source_dir = source_file
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or("");
    let source_parts = source_dir
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let target_parts = target_file
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    let mut common = 0;
    while common < source_parts.len()
        && common < target_parts.len()
        && source_parts[common] == target_parts[common]
    {
        common += 1;
    }

    let mut parts = Vec::new();
    for _ in common..source_parts.len() {
        parts.push("..".to_string());
    }
    parts.extend(
        target_parts[common..]
            .iter()
            .map(|part| (*part).to_string()),
    );

    if parts.is_empty() {
        note_file_name_from_path(target_file)
    } else {
        parts.join("/")
    }
}

fn note_file_name_from_path(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn markdown_label(value: &str) -> String {
    value.replace('\\', "\\\\").replace(']', "\\]")
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
