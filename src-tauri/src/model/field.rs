// Rust port of src/models/Field.js.

use super::data::{AUTO_HIDDEN_TYPES, FIELD_TYPES};
use crate::time_util::now_iso8601;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error("Field requires a non-empty label")]
    EmptyFieldLabel,
    #[error("Invalid field type: {0}")]
    InvalidFieldType(String),
    #[error("Folder requires a non-empty name")]
    EmptyFolderName,
    #[error("Category requires a non-empty name")]
    EmptyCategoryName,
    #[error("Entry requires a non-empty title")]
    EmptyEntryTitle,
    #[error("Invalid entry template: {0}")]
    InvalidEntryTemplate(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PasswordHistoryEntry {
    pub value: String,
    #[serde(rename = "changedAt")]
    pub changed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Field {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub value: String,
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<PasswordHistoryEntry>,
    // `default` (not required): the renderer's "add field" flow
    // (EntryForm.jsx's addField) sends brand-new fields as bare
    // {id, label, type, value, hidden} with no timestamps, and the JS
    // backend's updateEntryFields passes that through verbatim into the
    // persisted vault when there's no matching existing field id - so real
    // vault.xam files can contain Field objects missing these keys. A
    // required field here would make such a (currently-valid!) vault
    // unreadable.
    #[serde(rename = "createdAt", default)]
    pub created_at: String,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
}

pub struct CreateFieldOptions {
    pub label: String,
    pub field_type: String,
    pub value: String,
    pub hidden: Option<bool>,
}

impl Default for CreateFieldOptions {
    fn default() -> Self {
        Self { label: String::new(), field_type: "text".to_string(), value: String::new(), hidden: None }
    }
}

pub fn create_field(opts: CreateFieldOptions) -> Result<Field, ModelError> {
    if opts.label.is_empty() {
        return Err(ModelError::EmptyFieldLabel);
    }
    if !FIELD_TYPES.contains(&opts.field_type.as_str()) {
        return Err(ModelError::InvalidFieldType(opts.field_type));
    }
    let now = now_iso8601();
    let is_hidden = opts.hidden.unwrap_or_else(|| AUTO_HIDDEN_TYPES.contains(&opts.field_type.as_str()));
    Ok(Field {
        id: Uuid::new_v4().to_string(),
        label: opts.label,
        field_type: opts.field_type,
        value: opts.value,
        hidden: is_hidden,
        history: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Field updates as sent over IPC: any subset of fields, `field_type: None`
/// means "leave unchanged", `hidden: None` means "unspecified" (distinct
/// from Some(false)) so create_field/update_field can tell "not set" apart
/// from "explicitly false" the same way the JS `updates.hidden === undefined`
/// check does.
#[derive(Debug, Default)]
pub struct FieldUpdate {
    pub label: Option<String>,
    pub field_type: Option<String>,
    pub value: Option<String>,
    pub hidden: Option<bool>,
    pub history: Option<Vec<PasswordHistoryEntry>>,
}

pub fn update_field(field: &Field, updates: FieldUpdate) -> Result<Field, ModelError> {
    let mut next = field.clone();
    if let Some(label) = updates.label {
        next.label = label;
    }
    if let Some(value) = updates.value {
        next.value = value;
    }
    if let Some(history) = updates.history {
        next.history = history;
    }
    if let Some(field_type) = updates.field_type {
        if !FIELD_TYPES.contains(&field_type.as_str()) {
            return Err(ModelError::InvalidFieldType(field_type));
        }
        if updates.hidden.is_none() {
            next.hidden = AUTO_HIDDEN_TYPES.contains(&field_type.as_str());
        }
        next.field_type = field_type;
    }
    if let Some(hidden) = updates.hidden {
        next.hidden = hidden;
    }
    next.updated_at = now_iso8601();
    Ok(next)
}

pub fn is_field_valid(field: &Field) -> bool {
    !field.id.is_empty() && !field.label.is_empty() && FIELD_TYPES.contains(&field.field_type.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(label: &str, field_type: &str) -> CreateFieldOptions {
        CreateFieldOptions { label: label.to_string(), field_type: field_type.to_string(), ..Default::default() }
    }

    #[test]
    fn creates_a_field_with_defaults() {
        let field = create_field(opts("Username", "text")).unwrap();
        assert_eq!(field.label, "Username");
        assert_eq!(field.field_type, "text");
        assert_eq!(field.value, "");
        assert!(!field.hidden);
        assert!(field.history.is_empty());
    }

    #[test]
    fn auto_hides_password_and_pin_types() {
        assert!(create_field(opts("Password", "password")).unwrap().hidden);
        assert!(create_field(opts("PIN", "pin")).unwrap().hidden);
        assert!(!create_field(opts("Note", "note")).unwrap().hidden);
    }

    #[test]
    fn explicit_hidden_overrides_auto_hide() {
        let mut o = opts("Username", "text");
        o.hidden = Some(true);
        assert!(create_field(o).unwrap().hidden);
    }

    /// Regression test for a real EntryForm.jsx/VaultService.js interaction:
    /// the renderer's addField() sends brand-new fields as bare
    /// {id, label, type, value, hidden} with no timestamps, and JS's
    /// updateEntryFields persists that object verbatim when it doesn't
    /// match an existing field id - so real vault.xam files can contain
    /// Field objects with no createdAt/updatedAt. Must not fail to load.
    #[test]
    fn deserializes_a_field_missing_timestamps_like_a_real_freshly_added_one() {
        let json = r#"{"id":"new-1234-0","label":"Custom","type":"text","value":"hi","hidden":false}"#;
        let field: Field = serde_json::from_str(json).unwrap();
        assert_eq!(field.id, "new-1234-0");
        assert_eq!(field.created_at, "");
        assert_eq!(field.updated_at, "");
    }

    #[test]
    fn rejects_empty_label_or_invalid_type() {
        assert!(matches!(create_field(opts("", "text")), Err(ModelError::EmptyFieldLabel)));
        assert!(matches!(
            create_field(opts("X", "bogus")),
            Err(ModelError::InvalidFieldType(t)) if t == "bogus"
        ));
    }

    #[test]
    fn update_field_recomputes_hidden_when_type_changes_without_explicit_hidden() {
        let field = create_field(opts("X", "text")).unwrap();
        let updated = update_field(&field, FieldUpdate { field_type: Some("password".into()), ..Default::default() }).unwrap();
        assert!(updated.hidden);
    }

    #[test]
    fn update_field_respects_explicit_hidden_alongside_type_change() {
        let field = create_field(opts("X", "text")).unwrap();
        let updated = update_field(
            &field,
            FieldUpdate { field_type: Some("password".into()), hidden: Some(false), ..Default::default() },
        )
        .unwrap();
        assert!(!updated.hidden);
    }

    #[test]
    fn serializes_with_camel_case_keys_and_omits_empty_history() {
        let field = create_field(opts("Username", "text")).unwrap();
        let json = serde_json::to_value(&field).unwrap();
        assert!(json.get("history").is_none());
        assert!(json.get("createdAt").is_some());
        assert!(json.get("type").is_some());
    }
}
