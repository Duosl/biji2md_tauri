use reqwest::Client;
use serde_json::Value;

use crate::types::{Note, Tag};

const BASE_URL: &str = "https://get-notes.luojilab.com";
const NOTES_ENDPOINT: &str = "/voicenotes/web/notes";
pub struct NotesPage {
    pub notes: Vec<Note>,
    pub has_more: bool,
    pub total_items: Option<u64>,
}

pub struct ApiClient {
    client: Client,
    token: String,
}

impl ApiClient {
    pub fn new(token: &str) -> Result<Self, String> {
        let client = Client::builder()
            .user_agent("biji2md/0.1.0")
            .build()
            .map_err(|error| format!("failed to build api client: {error}"))?;

        Ok(Self {
            client,
            token: token.to_string(),
        })
    }

    pub async fn get_notes_page(
        &self,
        limit: usize,
        since_id: Option<&str>,
        sort: &str,
    ) -> Result<NotesPage, String> {
        let url = format!("{BASE_URL}{NOTES_ENDPOINT}");
        let mut request = self
            .client
            .get(url)
            .bearer_auth(&self.token)
            .query(&[("limit", limit.to_string()), ("sort", sort.to_string())]);

        if let Some(since_id) = since_id.filter(|value| !value.is_empty()) {
            request = request.query(&[("since_id", since_id)]);
        }

        let response = request
            .send()
            .await
            .map_err(|error| format!("failed to request notes: {error}"))?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN
        {
            return Err("鉴权失败，请检查 API Token 是否正确。".to_string());
        }

        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "unable to read response body".to_string());
            return Err(format!("notes api returned {status}: {body}"));
        }

        let value: Value = response
            .json()
            .await
            .map_err(|error| format!("failed to decode notes response: {error}"))?;

        Ok(NotesPage {
            notes: extract_notes(&value),
            has_more: extract_has_more(&value),
            total_items: extract_total_items(&value),
        })
    }
}

fn extract_notes(value: &Value) -> Vec<Note> {
    let candidates = [
        value,
        &value["c"]["list"],
        &value["c"]["notes"],
        &value["data"],
        &value["data"]["list"],
        &value["data"]["notes"],
        &value["list"],
        &value["notes"],
        &value["items"],
    ];

    for candidate in candidates {
        if let Some(array) = candidate.as_array() {
            let notes: Vec<Note> = array.iter().filter_map(note_from_value).collect();
            if !notes.is_empty() {
                return notes;
            }
        }
    }

    Vec::new()
}

fn extract_has_more(value: &Value) -> bool {
    value["c"]["has_more"].as_bool().unwrap_or(false)
}

fn extract_total_items(value: &Value) -> Option<u64> {
    value["c"]["total_items"].as_u64()
}

fn note_from_value(value: &Value) -> Option<Note> {
    let id = string_field(value, &["id", "note_id", "noteId"])?;
    let title = string_field(value, &["title", "name"]).unwrap_or_else(|| "Untitled".to_string());
    let content = string_field(value, &["content", "body", "text"]).unwrap_or_default();
    let edit_time = string_field(
        value,
        &[
            "edit_time",
            "editTime",
            "updated_at",
            "updatedAt",
            "update_time",
        ],
    )
    .unwrap_or_default();
    let created_at = string_field(
        value,
        &["created_at", "createdAt", "create_time", "created"],
    )
    .unwrap_or_default();
    let tags = parse_tags(value.get("tags").or_else(|| value.get("tag_list")));

    Some(Note {
        id,
        title,
        content,
        tags,
        edit_time,
        created_at,
    })
}

fn parse_tags(value: Option<&Value>) -> Vec<Tag> {
    let Some(value) = value else {
        return Vec::new();
    };

    let Some(array) = value.as_array() else {
        return Vec::new();
    };

    array
        .iter()
        .filter_map(|item| {
            if let Some(name) = item.as_str() {
                return Some(Tag {
                    id: None,
                    name: name.to_string(),
                });
            }

            let name = string_field(item, &["name", "title"])?;
            let id = string_field(item, &["id", "tag_id", "tagId"]);

            Some(Tag { id, name })
        })
        .collect()
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| match value.get(*key) {
        Some(Value::String(text)) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    })
}
