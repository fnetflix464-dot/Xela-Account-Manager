// Rust port of src/models/Entry.js.

use super::data::{template_by_name, ENTRY_TEMPLATES};
use super::field::{create_field, CreateFieldOptions, Field, ModelError};
use crate::time_util::now_iso8601;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn entry_templates() -> Vec<&'static str> {
    ENTRY_TEMPLATES.iter().map(|t| t.name).collect()
}

fn is_valid_template(template: &str) -> bool {
    template_by_name(template).is_some()
}

/// Returns the default field set for a given template (empty if unknown -
/// mirrors the JS lookup returning `undefined -> []`).
pub fn default_fields_for_template(template: &str) -> Vec<Field> {
    match template_by_name(template) {
        Some(t) => t
            .fields
            .iter()
            .map(|f| {
                create_field(CreateFieldOptions {
                    label: f.label.to_string(),
                    field_type: f.field_type.to_string(),
                    ..Default::default()
                })
                .expect("built-in template fields are always valid")
            })
            .collect(),
        None => Vec::new(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    pub id: String,
    pub title: String,
    pub template: String,
    pub icon: String,
    pub color: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub fields: Vec<Field>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

pub struct CreateEntryOptions {
    pub title: String,
    pub template: String,
    pub icon: Option<String>,
    pub color: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub fields: Option<Vec<Field>>,
}

impl Default for CreateEntryOptions {
    fn default() -> Self {
        Self {
            title: String::new(),
            template: "Custom".to_string(),
            icon: None,
            color: "#4a90d9".to_string(),
            favorite: false,
            tags: Vec::new(),
            fields: None,
        }
    }
}

pub fn create_entry(opts: CreateEntryOptions) -> Result<Entry, ModelError> {
    if opts.title.is_empty() {
        return Err(ModelError::EmptyEntryTitle);
    }
    if !is_valid_template(&opts.template) {
        return Err(ModelError::InvalidEntryTemplate(opts.template));
    }
    let now = now_iso8601();
    let icon = opts
        .icon
        .unwrap_or_else(|| template_by_name(&opts.template).map(|t| t.icon.to_string()).unwrap_or_else(|| "file".into()));
    let fields = opts.fields.unwrap_or_else(|| default_fields_for_template(&opts.template));

    Ok(Entry {
        id: Uuid::new_v4().to_string(),
        title: opts.title,
        template: opts.template,
        icon,
        color: opts.color,
        favorite: opts.favorite,
        tags: opts.tags,
        fields,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[derive(Debug, Default)]
pub struct EntryUpdate {
    pub title: Option<String>,
    pub template: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub fields: Option<Vec<Field>>,
}

pub fn update_entry(entry: &Entry, updates: EntryUpdate) -> Result<Entry, ModelError> {
    if let Some(template) = &updates.template {
        if !is_valid_template(template) {
            return Err(ModelError::InvalidEntryTemplate(template.clone()));
        }
    }
    let mut next = entry.clone();
    if let Some(title) = updates.title {
        next.title = title;
    }
    if let Some(template) = updates.template {
        next.template = template;
    }
    if let Some(icon) = updates.icon {
        next.icon = icon;
    }
    if let Some(color) = updates.color {
        next.color = color;
    }
    if let Some(favorite) = updates.favorite {
        next.favorite = favorite;
    }
    if let Some(tags) = updates.tags {
        next.tags = tags;
    }
    if let Some(fields) = updates.fields {
        next.fields = fields;
    }
    next.updated_at = now_iso8601();
    Ok(next)
}

pub fn duplicate_entry(entry: &Entry) -> Entry {
    let now = now_iso8601();
    let mut copy = entry.clone();
    copy.id = Uuid::new_v4().to_string();
    copy.title = format!("{} (Copy)", entry.title);
    copy.fields = entry.fields.iter().map(|f| Field { id: Uuid::new_v4().to_string(), ..f.clone() }).collect();
    copy.created_at = now.clone();
    copy.updated_at = now;
    copy
}

pub fn is_entry_valid(entry: &Entry) -> bool {
    !entry.id.is_empty() && !entry.title.is_empty() && is_valid_template(&entry.template)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_entry_with_default_template_fields() {
        let entry = create_entry(CreateEntryOptions { title: "My Bank".into(), template: "Bank Account".into(), ..Default::default() }).unwrap();
        assert_eq!(entry.icon, "bank");
        assert_eq!(entry.fields.len(), 4);
        assert_eq!(entry.fields[0].label, "Bank Name");
    }

    #[test]
    fn custom_template_has_no_forced_default_icon_override() {
        let entry = create_entry(CreateEntryOptions { title: "X".into(), ..Default::default() }).unwrap();
        assert_eq!(entry.template, "Custom");
        assert_eq!(entry.icon, "file");
    }

    #[test]
    fn rejects_empty_title_or_invalid_template() {
        assert!(matches!(
            create_entry(CreateEntryOptions { title: "".into(), ..Default::default() }),
            Err(ModelError::EmptyEntryTitle)
        ));
        assert!(matches!(
            create_entry(CreateEntryOptions { title: "X".into(), template: "Nope".into(), ..Default::default() }),
            Err(ModelError::InvalidEntryTemplate(t)) if t == "Nope"
        ));
    }

    #[test]
    fn duplicate_entry_mints_new_id_and_field_ids_but_keeps_values() {
        let entry = create_entry(CreateEntryOptions { title: "Login".into(), template: "Login".into(), ..Default::default() }).unwrap();
        let copy = duplicate_entry(&entry);
        assert_ne!(copy.id, entry.id);
        assert_eq!(copy.title, "Login (Copy)");
        assert_eq!(copy.fields.len(), entry.fields.len());
        for (orig, dup) in entry.fields.iter().zip(copy.fields.iter()) {
            assert_ne!(orig.id, dup.id);
            assert_eq!(orig.label, dup.label);
        }
    }

    #[test]
    fn update_entry_leaves_tags_and_fields_unchanged_when_not_provided() {
        let entry = create_entry(CreateEntryOptions { title: "X".into(), tags: vec!["a".into()], ..Default::default() }).unwrap();
        let updated = update_entry(&entry, EntryUpdate { title: Some("Y".into()), ..Default::default() }).unwrap();
        assert_eq!(updated.tags, vec!["a".to_string()]);
        assert_eq!(updated.fields.len(), entry.fields.len());
    }
}
