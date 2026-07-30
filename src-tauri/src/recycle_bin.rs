// Rust port of src/services/RecycleBinService.js.

use crate::model::vault::RecycleBinRecord;
use crate::model::{Category, Entry, Folder, Vault};
use crate::time_util::now_iso8601;
use uuid::Uuid;

pub fn build_category_record(item: Category) -> RecycleBinRecord {
    RecycleBinRecord::Category { id: Uuid::new_v4().to_string(), item, deleted_at: now_iso8601() }
}

pub fn build_folder_record(item: Folder, category_id: String) -> RecycleBinRecord {
    RecycleBinRecord::Folder { id: Uuid::new_v4().to_string(), item, category_id, deleted_at: now_iso8601() }
}

pub fn build_entry_record(item: Entry, category_id: String, folder_id: String) -> RecycleBinRecord {
    RecycleBinRecord::Entry { id: Uuid::new_v4().to_string(), item, category_id, folder_id, deleted_at: now_iso8601() }
}

/// Prepends a record to the vault's recycle bin, returning a new vault.
pub fn add_record(vault: &Vault, record: RecycleBinRecord) -> Vault {
    let mut next = vault.clone();
    next.recycle_bin.insert(0, record);
    next
}

pub fn find_record<'a>(vault: &'a Vault, recycle_id: &str) -> Option<&'a RecycleBinRecord> {
    vault.recycle_bin.iter().find(|r| r.id() == recycle_id)
}

/// Removes a record from the recycle bin (used both by restore and by
/// permanent deletion - the only difference is whether the caller
/// re-inserts the item into the live tree first).
pub fn remove_record(vault: &Vault, recycle_id: &str) -> Vault {
    let mut next = vault.clone();
    next.recycle_bin.retain(|r| r.id() != recycle_id);
    next
}

pub fn clear(vault: &Vault) -> Vault {
    let mut next = vault.clone();
    next.recycle_bin.clear();
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::vault::create_vault;
    use crate::model::{CreateCategoryOptions, category::create_category};

    #[test]
    fn add_find_remove_round_trip() {
        let vault = create_vault();
        let category = create_category(CreateCategoryOptions { name: "X".into(), ..Default::default() }).unwrap();
        let record = build_category_record(category);
        let id = record.id().to_string();

        let vault = add_record(&vault, record);
        assert!(find_record(&vault, &id).is_some());

        let vault = remove_record(&vault, &id);
        assert!(find_record(&vault, &id).is_none());
    }

    #[test]
    fn clear_empties_the_bin() {
        let vault = create_vault();
        let category = create_category(CreateCategoryOptions { name: "X".into(), ..Default::default() }).unwrap();
        let vault = add_record(&vault, build_category_record(category));
        assert_eq!(vault.recycle_bin.len(), 1);
        let vault = clear(&vault);
        assert!(vault.recycle_bin.is_empty());
    }
}
