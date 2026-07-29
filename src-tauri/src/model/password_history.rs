// Rust port of src/models/PasswordHistory.js.

use super::field::{Field, PasswordHistoryEntry};

const SECRET_FIELD_TYPES: &[&str] = &["password", "pin"];

pub fn is_secret_field_type(field_type: &str) -> bool {
    SECRET_FIELD_TYPES.contains(&field_type)
}

/// Computes the next `history` for a field whose value is changing, given
/// the field's *previous* state (before the incoming update) and a
/// retention limit. Non-secret fields never accrue history.
pub fn next_history(existing_field: &Field, limit: i64) -> Vec<PasswordHistoryEntry> {
    if !is_secret_field_type(&existing_field.field_type) {
        return existing_field.history.clone();
    }
    if limit <= 0 {
        return Vec::new();
    }
    let entry = PasswordHistoryEntry {
        value: existing_field.value.clone(),
        changed_at: existing_field.updated_at.clone(),
    };
    let mut history = vec![entry];
    history.extend(existing_field.history.iter().cloned());
    history.truncate(limit as usize);
    history
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::field::{create_field, CreateFieldOptions};

    #[test]
    fn non_secret_fields_never_accrue_history() {
        let field = create_field(CreateFieldOptions {
            label: "Note".into(),
            field_type: "note".into(),
            value: "hello".into(),
            hidden: None,
        })
        .unwrap();
        assert!(next_history(&field, 20).is_empty());
    }

    #[test]
    fn zero_or_negative_limit_disables_history() {
        let field = create_field(CreateFieldOptions {
            label: "Password".into(),
            field_type: "password".into(),
            value: "old-value".into(),
            hidden: None,
        })
        .unwrap();
        assert!(next_history(&field, 0).is_empty());
    }

    #[test]
    fn prepends_and_truncates_to_limit() {
        let mut field = create_field(CreateFieldOptions {
            label: "Password".into(),
            field_type: "password".into(),
            value: "v1".into(),
            hidden: None,
        })
        .unwrap();
        field.history = vec![
            PasswordHistoryEntry { value: "v0".into(), changed_at: "t0".into() },
        ];
        let history = next_history(&field, 1);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].value, "v1");
    }
}
