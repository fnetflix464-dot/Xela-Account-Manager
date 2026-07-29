// Rust port of src/services/ActivityLogService.js.

use crate::model::vault::ActivityLogEntry;
use crate::model::Vault;
use crate::time_util::now_iso8601;
use uuid::Uuid;

// Capped so the vault file doesn't grow unbounded over the life of a vault.
pub const MAX_ACTIVITY_LOG_ENTRIES: usize = 500;

/// Appends an activity log entry to a vault, returning a new vault object.
pub fn record(vault: &Vault, action: &str, details: serde_json::Value) -> Vault {
    let entry = ActivityLogEntry {
        id: Uuid::new_v4().to_string(),
        action: action.to_string(),
        details,
        timestamp: now_iso8601(),
    };
    let mut next = vault.clone();
    next.activity_log.insert(0, entry);
    next.activity_log.truncate(MAX_ACTIVITY_LOG_ENTRIES);
    next
}

/// Returns the most recent `limit` activity log entries, newest first.
pub fn list(vault: &Vault, limit: usize) -> Vec<ActivityLogEntry> {
    vault.activity_log.iter().take(limit).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::vault::create_vault;
    use serde_json::json;

    #[test]
    fn record_prepends_newest_first() {
        let vault = create_vault();
        let vault = record(&vault, "entry.created", json!({ "entryId": "e1" }));
        let vault = record(&vault, "entry.deleted", json!({ "entryId": "e1" }));
        assert_eq!(vault.activity_log[0].action, "entry.deleted");
        assert_eq!(vault.activity_log[1].action, "entry.created");
    }

    #[test]
    fn record_caps_at_max_entries() {
        let mut vault = create_vault();
        for i in 0..(MAX_ACTIVITY_LOG_ENTRIES + 10) {
            vault = record(&vault, "x", json!({ "i": i }));
        }
        assert_eq!(vault.activity_log.len(), MAX_ACTIVITY_LOG_ENTRIES);
        // Newest survives, oldest got dropped.
        assert_eq!(vault.activity_log[0].details["i"], MAX_ACTIVITY_LOG_ENTRIES + 9);
    }

    #[test]
    fn list_respects_limit() {
        let mut vault = create_vault();
        for i in 0..5 {
            vault = record(&vault, "x", json!({ "i": i }));
        }
        assert_eq!(list(&vault, 2).len(), 2);
    }
}
