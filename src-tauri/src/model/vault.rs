// Rust port of src/models/Vault.js.

use super::category::Category;
use super::entry::Entry;
use super::folder::Folder;
use super::settings::{create_settings, Settings};
use crate::time_util::now_iso8601;
use serde::{Deserialize, Serialize};

pub const VAULT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityLogEntry {
    pub id: String,
    pub action: String,
    #[serde(default)]
    pub details: serde_json::Value,
    pub timestamp: String,
}

/// The three recycled item types genuinely carry different parent-reference
/// fields (a category has none, a folder needs categoryId, an entry needs
/// both) - an internally-tagged enum expresses that shape difference
/// directly instead of leaving it to callers to keep straight, mirroring
/// RecycleBinService.js's buildRecord().
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RecycleBinRecord {
    Category {
        id: String,
        item: Category,
        #[serde(rename = "deletedAt")]
        deleted_at: String,
    },
    Folder {
        id: String,
        item: Folder,
        #[serde(rename = "categoryId")]
        category_id: String,
        #[serde(rename = "deletedAt")]
        deleted_at: String,
    },
    Entry {
        id: String,
        item: Entry,
        #[serde(rename = "categoryId")]
        category_id: String,
        #[serde(rename = "folderId")]
        folder_id: String,
        #[serde(rename = "deletedAt")]
        deleted_at: String,
    },
}

impl RecycleBinRecord {
    pub fn id(&self) -> &str {
        match self {
            RecycleBinRecord::Category { id, .. }
            | RecycleBinRecord::Folder { id, .. }
            | RecycleBinRecord::Entry { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Vault {
    pub version: u32,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub settings: Settings,
    pub categories: Vec<Category>,
    #[serde(rename = "activityLog")]
    pub activity_log: Vec<ActivityLogEntry>,
    #[serde(rename = "recycleBin")]
    pub recycle_bin: Vec<RecycleBinRecord>,
}

pub fn create_vault() -> Vault {
    let now = now_iso8601();
    Vault {
        version: VAULT_VERSION,
        created_at: now.clone(),
        updated_at: now,
        settings: create_settings(),
        categories: Vec::new(),
        activity_log: Vec::new(),
        recycle_bin: Vec::new(),
    }
}

pub fn touch_vault(vault: &Vault) -> Vault {
    let mut next = vault.clone();
    next.updated_at = now_iso8601();
    next
}

pub fn is_vault_valid(vault: &Vault) -> bool {
    // version/settings/categories/activityLog/recycleBin are non-optional
    // in this struct already - a Vault value that deserialized at all has
    // satisfied everything the JS isVaultValid() checks. Kept as a
    // same-named function for parity with the call sites that use it as
    // an explicit post-decrypt integrity gate.
    let _ = vault;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_vault_has_expected_defaults() {
        let vault = create_vault();
        assert_eq!(vault.version, VAULT_VERSION);
        assert!(vault.categories.is_empty());
        assert!(vault.activity_log.is_empty());
        assert!(vault.recycle_bin.is_empty());
        assert_eq!(vault.created_at, vault.updated_at);
    }

    #[test]
    fn touch_vault_updates_timestamp_without_mutating_original() {
        let vault = create_vault();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let touched = touch_vault(&vault);
        assert_ne!(touched.updated_at, vault.updated_at);
        assert_eq!(touched.created_at, vault.created_at);
    }

    #[test]
    fn recycle_bin_record_serializes_with_type_tag_and_variant_shape() {
        let record = RecycleBinRecord::Folder {
            id: "r1".into(),
            item: super::super::folder::create_folder(super::super::folder::CreateFolderOptions {
                name: "F".into(),
                ..Default::default()
            })
            .unwrap(),
            category_id: "c1".into(),
            deleted_at: "t".into(),
        };
        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["type"], "folder");
        assert_eq!(json["categoryId"], "c1");
        assert!(json.get("folderId").is_none());

        let round_tripped: RecycleBinRecord = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, record);
    }
}
