// Rust port of src/services/VaultService.js. Holds all runtime state for a
// single unlocked vault session (the derived key and decrypted vault
// object live only in memory, never on disk in plaintext). One instance
// per app run, held behind a Mutex in Tauri's managed state.

#![allow(dead_code)]

use crate::activity_log;
use crate::crypto::CryptoError;
use crate::model::field::{update_field, FieldUpdate, ModelError};
use crate::model::folder::{find_folder_by_id, find_parent_folder};
use crate::model::password_history::next_history;
use crate::model::vault::{create_vault, is_vault_valid, touch_vault, RecycleBinRecord};
use crate::model::{
    category::create_category, entry::create_entry, entry::duplicate_entry, entry::update_entry as apply_entry_update,
    folder::create_folder, Category, CreateCategoryOptions, CreateEntryOptions, CreateFolderOptions, Entry,
    EntryUpdate, Field, Folder, Settings, SettingsUpdate, Vault,
};
use crate::quick_unlock::{self, KeyringBackend, QuickUnlockError};
use crate::recycle_bin;
use crate::search::{self, SearchResult};
use crate::settings_service::{self, SettingsError};
use crate::vault_file::FileError;
use crate::vault_repository::{self, RepositoryError};
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum VaultServiceError {
    #[error("Vault is locked")]
    Locked,
    #[error("A vault already exists")]
    VaultAlreadyExists,
    #[error("Master password must be at least 8 characters")]
    MasterPasswordTooShort,
    #[error("New master password must be at least 8 characters")]
    NewMasterPasswordTooShort,
    #[error("Current password is incorrect")]
    CurrentPasswordIncorrect,
    #[error("Vault file is corrupted")]
    VaultFileCorrupted,
    #[error("Import file is not a valid vault")]
    ImportFileInvalid,
    #[error("Category not found")]
    CategoryNotFound,
    #[error("Folder not found")]
    FolderNotFound,
    #[error("Entry not found")]
    EntryNotFound,
    #[error("Target category not found")]
    TargetCategoryNotFound,
    #[error("Original category no longer exists")]
    OriginalCategoryGone,
    #[error("Original folder no longer exists")]
    OriginalFolderGone,
    #[error("Recycle bin item not found")]
    RecycleBinItemNotFound,
    #[error("Quick unlock is not configured")]
    QuickUnlockNotConfigured,
    #[error(transparent)]
    Model(#[from] ModelError),
    #[error(transparent)]
    Settings(#[from] SettingsError),
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error(transparent)]
    QuickUnlock(#[from] QuickUnlockError),
    #[error(transparent)]
    Crypto(#[from] CryptoError),
    #[error(transparent)]
    File(#[from] FileError),
}

pub struct VaultEvent {
    pub action: String,
    pub details: serde_json::Value,
    pub timestamp: String,
}

struct Session {
    session_key: Vec<u8>,
    salt: Vec<u8>,
    vault: Vault,
}

pub struct VaultServiceConfig {
    pub vault_file_path: PathBuf,
    pub backup_dir: PathBuf,
    pub quick_unlock_file_path: Option<PathBuf>,
}

pub struct VaultService {
    vault_file_path: PathBuf,
    backup_dir: PathBuf,
    quick_unlock_file_path: Option<PathBuf>,
    keyring: Box<dyn KeyringBackend + Send>,
    session: Option<Session>,
    events: Vec<VaultEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReusedPasswordEntry {
    pub id: String,
    pub title: String,
    #[serde(rename = "categoryName")]
    pub category_name: String,
    #[serde(rename = "folderPath")]
    pub folder_path: String,
}

impl VaultService {
    pub fn new(config: VaultServiceConfig, keyring: Box<dyn KeyringBackend + Send>) -> Self {
        Self {
            vault_file_path: config.vault_file_path,
            backup_dir: config.backup_dir,
            quick_unlock_file_path: config.quick_unlock_file_path,
            keyring,
            session: None,
            events: Vec::new(),
        }
    }

    /// Drains and returns every VaultEvent recorded since the last drain -
    /// the caller (IPC layer) forwards these to the renderer via Tauri's
    /// event system and feeds vault-lifecycle ones to CommandManager::clear.
    pub fn drain_events(&mut self) -> Vec<VaultEvent> {
        std::mem::take(&mut self.events)
    }

    fn push_event(&mut self, action: &str, details: serde_json::Value) {
        self.events.push(VaultEvent { action: action.to_string(), details, timestamp: crate::time_util::now_iso8601() });
    }

    fn invalidate_quick_unlock(&self) {
        if let Some(path) = &self.quick_unlock_file_path {
            let _ = quick_unlock::disable(path, self.keyring.as_ref());
        }
    }

    // ---- session -------------------------------------------------------

    pub fn vault_file_exists(&self) -> bool {
        vault_repository::exists(&self.vault_file_path)
    }

    /// Reports whether the vault file (if any) is at least well-formed,
    /// without needing a password - callable while locked.
    pub fn is_vault_file_healthy(&self) -> bool {
        if !self.vault_file_exists() {
            return true; // nothing to be unhealthy yet
        }
        vault_repository::is_structurally_valid(&self.vault_file_path)
    }

    pub fn is_unlocked(&self) -> bool {
        self.session.is_some()
    }

    fn require_unlocked(&self) -> Result<&Session, VaultServiceError> {
        self.session.as_ref().ok_or(VaultServiceError::Locked)
    }

    fn require_unlocked_mut(&mut self) -> Result<&mut Session, VaultServiceError> {
        self.session.as_mut().ok_or(VaultServiceError::Locked)
    }

    pub fn lock(&mut self) {
        if let Some(mut session) = self.session.take() {
            session.session_key.iter_mut().for_each(|b| *b = 0);
            session.salt.iter_mut().for_each(|b| *b = 0);
        }
        self.push_event("vault.locked", json!({}));
    }

    /// Persists the in-memory vault to disk via the repository.
    fn persist(&mut self) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked()?;
        vault_repository::save(
            &self.vault_file_path,
            &self.backup_dir,
            &session.vault,
            &session.session_key,
            &session.salt,
            session.vault.settings.backup_count.max(0) as usize,
        )?;
        Ok(())
    }

    /// Creates a brand-new vault protected by master_password. Fails if a
    /// vault already exists at vault_file_path.
    pub fn create(&mut self, master_password: &str) -> Result<(), VaultServiceError> {
        if self.vault_file_exists() {
            return Err(VaultServiceError::VaultAlreadyExists);
        }
        if master_password.len() < 8 {
            return Err(VaultServiceError::MasterPasswordTooShort);
        }

        let initial_vault = activity_log::record(&create_vault(), "vault.created", json!({}));
        let (session_key, salt) =
            vault_repository::create(&self.vault_file_path, &self.backup_dir, master_password, &initial_vault)?;
        self.session = Some(Session { session_key: session_key.to_vec(), salt, vault: initial_vault });
        self.push_event("vault.created", json!({}));
        Ok(())
    }

    /// Attempts to unlock the vault with the given password.
    pub fn unlock(&mut self, master_password: &str) -> Result<(), VaultServiceError> {
        let unlocked = vault_repository::load::<Vault>(&self.vault_file_path, master_password)?;
        if !is_vault_valid(&unlocked.vault) {
            return Err(VaultServiceError::VaultFileCorrupted);
        }
        self.session = Some(Session { session_key: unlocked.session_key.to_vec(), salt: unlocked.salt, vault: unlocked.vault });
        self.push_event("vault.unlocked", json!({}));
        Ok(())
    }

    // ---- PIN quick unlock ------------------------------------------------

    pub fn is_quick_unlock_available(&self) -> bool {
        quick_unlock::is_available(self.keyring.as_ref())
    }

    pub fn is_quick_unlock_enabled(&self) -> bool {
        self.quick_unlock_file_path.as_deref().is_some_and(quick_unlock::is_enabled)
    }

    pub fn enable_quick_unlock(&mut self, pin: &str) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked()?;
        let Some(path) = self.quick_unlock_file_path.clone() else {
            return Err(VaultServiceError::QuickUnlockNotConfigured);
        };
        quick_unlock::enable(&path, self.keyring.as_ref(), pin, &session.session_key, &session.salt)?;
        Ok(())
    }

    pub fn disable_quick_unlock(&self) -> Result<(), VaultServiceError> {
        if let Some(path) = &self.quick_unlock_file_path {
            quick_unlock::disable(path, self.keyring.as_ref())?;
        }
        Ok(())
    }

    pub fn unlock_with_pin(&mut self, pin: &str) -> Result<(), VaultServiceError> {
        let Some(path) = self.quick_unlock_file_path.clone() else {
            return Err(VaultServiceError::QuickUnlockNotConfigured);
        };
        let recovered = quick_unlock::unlock(&path, self.keyring.as_ref(), pin)?;
        let unlocked = vault_repository::load_with_key::<Vault>(&self.vault_file_path, &recovered.session_key, &recovered.salt)?;
        if !is_vault_valid(&unlocked.vault) {
            return Err(VaultServiceError::VaultFileCorrupted);
        }
        self.session = Some(Session { session_key: unlocked.session_key.to_vec(), salt: unlocked.salt, vault: unlocked.vault });
        self.push_event("vault.unlocked", json!({}));
        Ok(())
    }

    pub fn get_vault(&self) -> Result<&Vault, VaultServiceError> {
        Ok(&self.require_unlocked()?.vault)
    }

    /// Replaces the in-memory vault wholesale with a previously-captured
    /// snapshot and persists it. Used by undo/redo - deliberately does not
    /// touch_vault() the snapshot, so restoring is byte-identical to the
    /// state that was actually captured.
    pub fn restore_snapshot(&mut self, snapshot: Vault) -> Result<(), VaultServiceError> {
        self.require_unlocked_mut()?.vault = snapshot;
        self.persist()
    }

    pub fn change_master_password(&mut self, current_password: &str, new_password: &str) -> Result<(), VaultServiceError> {
        {
            let session = self.require_unlocked()?;
            if !vault_repository::verify_key(current_password, &session.salt, &session.session_key) {
                return Err(VaultServiceError::CurrentPasswordIncorrect);
            }
        }
        if new_password.len() < 8 {
            return Err(VaultServiceError::NewMasterPasswordTooShort);
        }
        let (new_key, new_salt) = vault_repository::derive_new_key(new_password)?;
        {
            let session = self.require_unlocked_mut()?;
            session.session_key.iter_mut().for_each(|b| *b = 0);
            session.salt.iter_mut().for_each(|b| *b = 0);
            session.session_key = new_key.to_vec();
            session.salt = new_salt;
            session.vault = activity_log::record(&touch_vault(&session.vault), "vault.masterPasswordChanged", json!({}));
        }
        self.persist()?;
        self.invalidate_quick_unlock();
        self.push_event("vault.masterPasswordChanged", json!({}));
        Ok(())
    }

    // ---- tree location helpers -----------------------------------------

    /// Owned lookup result (category id/name + folder clone + parent/root
    /// folder ids) so callers don't hold a borrow into `vault` across a
    /// subsequent mutation of it.
    fn locate_folder(vault: &Vault, folder_id: &str) -> Option<(String, Folder, Option<String>, String)> {
        for category in &vault.categories {
            for root in &category.folders {
                if let Some(found) = find_folder_by_id(root, folder_id) {
                    let parent = find_parent_folder(root, folder_id).map(|p| p.id.clone());
                    return Some((category.id.clone(), found.clone(), parent, root.id.clone()));
                }
            }
        }
        None
    }

    fn locate_entry(vault: &Vault, entry_id: &str) -> Option<(String, String, Entry)> {
        fn search_folder(folder: &Folder, entry_id: &str) -> Option<Entry> {
            if let Some(found) = folder.entries.iter().find(|e| e.id == entry_id) {
                return Some(found.clone());
            }
            folder.folders.iter().find_map(|f| search_folder(f, entry_id))
        }
        fn locate_owning_folder(folder: &Folder, entry_id: &str) -> Option<String> {
            if folder.entries.iter().any(|e| e.id == entry_id) {
                return Some(folder.id.clone());
            }
            folder.folders.iter().find_map(|f| locate_owning_folder(f, entry_id))
        }

        for category in &vault.categories {
            for root in &category.folders {
                if let Some(entry) = search_folder(root, entry_id) {
                    let folder_id = locate_owning_folder(root, entry_id).unwrap();
                    return Some((category.id.clone(), folder_id, entry));
                }
            }
        }
        None
    }

    fn replace_folder_in_tree(root: &Folder, folder_id: &str, updater: &dyn Fn(&Folder) -> Folder) -> Folder {
        if root.id == folder_id {
            return updater(root);
        }
        let mut next = root.clone();
        next.folders = next.folders.iter().map(|f| Self::replace_folder_in_tree(f, folder_id, updater)).collect();
        next
    }

    fn mutate_folder(vault: &Vault, category_id: &str, folder_id: &str, updater: &dyn Fn(&Folder) -> Folder) -> Vault {
        let mut next = vault.clone();
        next.categories = next
            .categories
            .iter()
            .map(|cat| {
                if cat.id != category_id {
                    return cat.clone();
                }
                let mut c = cat.clone();
                c.folders = c.folders.iter().map(|root| Self::replace_folder_in_tree(root, folder_id, updater)).collect();
                c
            })
            .collect();
        next
    }

    // ---- categories ------------------------------------------------------

    pub fn add_category(&mut self, name: &str, icon: Option<&str>) -> Result<Category, VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let category = create_category(CreateCategoryOptions {
            name: name.to_string(),
            icon: icon.unwrap_or("category").to_string(),
            folders: Vec::new(),
        })?;
        let mut next = session.vault.clone();
        next.categories.push(category.clone());
        session.vault = activity_log::record(&touch_vault(&next), "category.created", json!({ "categoryId": category.id, "name": name }));
        self.persist()?;
        self.push_event("category.created", json!({ "categoryId": category.id, "name": name }));
        Ok(category)
    }

    pub fn rename_category(&mut self, category_id: &str, name: &str) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let mut next = session.vault.clone();
        for cat in &mut next.categories {
            if cat.id == category_id {
                cat.name = name.to_string();
            }
        }
        session.vault = activity_log::record(&touch_vault(&next), "category.renamed", json!({ "categoryId": category_id, "name": name }));
        self.persist()?;
        self.push_event("category.renamed", json!({ "categoryId": category_id, "name": name }));
        Ok(())
    }

    pub fn delete_category(&mut self, category_id: &str) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let category = session
            .vault
            .categories
            .iter()
            .find(|c| c.id == category_id)
            .cloned()
            .ok_or(VaultServiceError::CategoryNotFound)?;

        let recycled = recycle_bin::build_category_record(category.clone());
        let mut next = session.vault.clone();
        next.categories.retain(|c| c.id != category_id);
        let next = recycle_bin::add_record(&touch_vault(&next), recycled);
        session.vault = activity_log::record(&next, "category.deleted", json!({ "categoryId": category_id, "name": category.name }));
        self.persist()?;
        self.push_event("category.deleted", json!({ "categoryId": category_id, "name": category.name }));
        Ok(())
    }

    // ---- folders -----------------------------------------------------------

    pub fn add_folder(&mut self, category_id: &str, parent_folder_id: Option<&str>, name: &str) -> Result<Folder, VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        if !session.vault.categories.iter().any(|c| c.id == category_id) {
            return Err(VaultServiceError::CategoryNotFound);
        }
        let new_folder = create_folder(CreateFolderOptions { name: name.to_string(), icon: "folder".to_string() })?;

        let mut next = match parent_folder_id {
            None => {
                let mut next = session.vault.clone();
                for cat in &mut next.categories {
                    if cat.id == category_id {
                        cat.folders.push(new_folder.clone());
                    }
                }
                next
            }
            Some(parent_id) => {
                let nf = new_folder.clone();
                Self::mutate_folder(&session.vault, category_id, parent_id, &move |f| {
                    let mut f = f.clone();
                    f.folders.push(nf.clone());
                    f
                })
            }
        };
        next = activity_log::record(&touch_vault(&next), "folder.created", json!({ "folderId": new_folder.id, "name": name }));
        session.vault = next;
        self.persist()?;
        self.push_event("folder.created", json!({ "folderId": new_folder.id, "name": name }));
        Ok(new_folder)
    }

    pub fn rename_folder(&mut self, category_id: &str, folder_id: &str, name: &str) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let owned_name = name.to_string();
        let next = Self::mutate_folder(&session.vault, category_id, folder_id, &move |f| {
            let mut f = f.clone();
            f.name = owned_name.clone();
            f.updated_at = crate::time_util::now_iso8601();
            f
        });
        session.vault = activity_log::record(&touch_vault(&next), "folder.renamed", json!({ "folderId": folder_id, "name": name }));
        self.persist()?;
        self.push_event("folder.renamed", json!({ "folderId": folder_id, "name": name }));
        Ok(())
    }

    fn delete_folder_no_recycle(vault: &Vault, category_id: &str, folder_id: &str) -> Vault {
        let Some((_, _, parent_folder_id, _)) = Self::locate_folder(vault, folder_id) else {
            return vault.clone();
        };
        match parent_folder_id {
            Some(parent_id) => Self::mutate_folder(vault, category_id, &parent_id, &move |f| {
                let mut f = f.clone();
                f.folders.retain(|c| c.id != folder_id);
                f
            }),
            None => {
                let mut next = vault.clone();
                for cat in &mut next.categories {
                    if cat.id == category_id {
                        cat.folders.retain(|f| f.id != folder_id);
                    }
                }
                next
            }
        }
    }

    pub fn delete_folder(&mut self, category_id: &str, folder_id: &str) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let (_, folder, parent_folder_id, _) =
            Self::locate_folder(&session.vault, folder_id).ok_or(VaultServiceError::FolderNotFound)?;

        let recycled = recycle_bin::build_folder_record(folder.clone(), category_id.to_string());
        let next = Self::delete_folder_no_recycle(&session.vault, category_id, folder_id);
        let _ = parent_folder_id;
        let next = recycle_bin::add_record(&touch_vault(&next), recycled);
        session.vault = activity_log::record(&next, "folder.deleted", json!({ "folderId": folder_id, "name": folder.name }));
        self.persist()?;
        self.push_event("folder.deleted", json!({ "folderId": folder_id, "name": folder.name }));
        Ok(())
    }

    /// `before_folder_id`, when given, inserts the folder immediately
    /// before that sibling in the target's folder list instead of
    /// appending at the end - this is what makes sibling reordering (not
    /// just re-parenting) possible.
    pub fn move_folder(
        &mut self,
        folder_id: &str,
        target_category_id: &str,
        target_parent_folder_id: Option<&str>,
        before_folder_id: Option<&str>,
    ) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let (source_category_id, folder, _, _) =
            Self::locate_folder(&session.vault, folder_id).ok_or(VaultServiceError::FolderNotFound)?;
        if !session.vault.categories.iter().any(|c| c.id == target_category_id) {
            return Err(VaultServiceError::TargetCategoryNotFound);
        }

        let before_id = before_folder_id.map(|s| s.to_string());
        let folder_to_insert = folder.clone();
        let insert_folder = move |siblings: &[Folder]| -> Vec<Folder> {
            let index = before_id.as_deref().and_then(|b| siblings.iter().position(|f| f.id == b));
            let mut result = siblings.to_vec();
            match index {
                Some(i) => result.insert(i, folder_to_insert.clone()),
                None => result.push(folder_to_insert.clone()),
            }
            result
        };

        let removed = Self::delete_folder_no_recycle(&session.vault, &source_category_id, folder_id);
        let inserted = match target_parent_folder_id {
            None => {
                let mut next = removed;
                for cat in &mut next.categories {
                    if cat.id == target_category_id {
                        cat.folders = insert_folder(&cat.folders);
                    }
                }
                next
            }
            Some(parent_id) => Self::mutate_folder(&removed, target_category_id, parent_id, &move |f| {
                let mut f = f.clone();
                f.folders = insert_folder(&f.folders);
                f
            }),
        };

        session.vault = activity_log::record(
            &touch_vault(&inserted),
            "folder.moved",
            json!({ "folderId": folder_id, "targetCategoryId": target_category_id, "targetParentFolderId": target_parent_folder_id }),
        );
        self.persist()?;
        self.push_event(
            "folder.moved",
            json!({ "folderId": folder_id, "targetCategoryId": target_category_id, "targetParentFolderId": target_parent_folder_id }),
        );
        Ok(())
    }

    // ---- entries -----------------------------------------------------------

    pub fn add_entry(&mut self, category_id: &str, folder_id: &str, entry_data: CreateEntryOptions) -> Result<Entry, VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let entry = create_entry(entry_data)?;
        let entry_for_insert = entry.clone();
        let next = Self::mutate_folder(&session.vault, category_id, folder_id, &move |f| {
            let mut f = f.clone();
            f.entries.push(entry_for_insert.clone());
            f
        });
        session.vault = activity_log::record(&touch_vault(&next), "entry.created", json!({ "entryId": entry.id, "title": entry.title }));
        self.persist()?;
        self.push_event("entry.created", json!({ "entryId": entry.id, "title": entry.title }));
        Ok(entry)
    }

    pub fn update_entry_fields(&mut self, entry_id: &str, updates: EntryFieldsUpdate) -> Result<Entry, VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let (category_id, folder_id, entry) =
            Self::locate_entry(&session.vault, entry_id).ok_or(VaultServiceError::EntryNotFound)?;

        let history_limit = session.vault.settings.password_history_limit;
        let next_fields: Option<Vec<Field>> = updates.fields.as_ref().map(|incoming_fields| {
            incoming_fields
                .iter()
                .map(|incoming| {
                    let existing = entry.fields.iter().find(|f| f.id == incoming.id);
                    match existing {
                        None => incoming.clone().into_field(), // brand-new field appended by the UI
                        Some(existing) if existing.value == incoming.value => {
                            let mut merged = existing.clone();
                            merged.label = incoming.label.clone();
                            merged.field_type = incoming.field_type.clone();
                            merged.value = incoming.value.clone();
                            merged.hidden = incoming.hidden;
                            merged
                        }
                        Some(existing) => {
                            let history = next_history(existing, history_limit);
                            update_field(
                                existing,
                                FieldUpdate {
                                    label: Some(incoming.label.clone()),
                                    field_type: Some(incoming.field_type.clone()),
                                    value: Some(incoming.value.clone()),
                                    hidden: Some(incoming.hidden),
                                    history: Some(history),
                                },
                            )
                            .expect("incoming field_type already validated by IncomingField construction")
                        }
                    }
                })
                .collect()
        });

        let updated_entry = apply_entry_update(
            &entry,
            EntryUpdate {
                title: updates.title,
                template: updates.template,
                icon: updates.icon,
                color: updates.color,
                favorite: updates.favorite,
                tags: updates.tags,
                fields: next_fields,
            },
        )?;

        let ue = updated_entry.clone();
        let next = Self::mutate_folder(&session.vault, &category_id, &folder_id, &move |f| {
            let mut f = f.clone();
            for e in &mut f.entries {
                if e.id == entry_id {
                    *e = ue.clone();
                }
            }
            f
        });
        session.vault = activity_log::record(&touch_vault(&next), "entry.updated", json!({ "entryId": entry_id, "title": updated_entry.title }));
        self.persist()?;
        self.push_event("entry.updated", json!({ "entryId": entry_id, "title": updated_entry.title }));
        Ok(updated_entry)
    }

    pub fn delete_entry(&mut self, entry_id: &str) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let (category_id, folder_id, entry) =
            Self::locate_entry(&session.vault, entry_id).ok_or(VaultServiceError::EntryNotFound)?;

        let recycled = recycle_bin::build_entry_record(entry.clone(), category_id.clone(), folder_id.clone());
        let next = Self::mutate_folder(&session.vault, &category_id, &folder_id, &move |f| {
            let mut f = f.clone();
            f.entries.retain(|e| e.id != entry_id);
            f
        });
        let next = recycle_bin::add_record(&touch_vault(&next), recycled);
        session.vault = activity_log::record(&next, "entry.deleted", json!({ "entryId": entry_id, "title": entry.title }));
        self.persist()?;
        self.push_event("entry.deleted", json!({ "entryId": entry_id, "title": entry.title }));
        Ok(())
    }

    pub fn move_entry(&mut self, entry_id: &str, target_category_id: &str, target_folder_id: &str) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let (source_category_id, source_folder_id, entry) =
            Self::locate_entry(&session.vault, entry_id).ok_or(VaultServiceError::EntryNotFound)?;

        let next = Self::mutate_folder(&session.vault, &source_category_id, &source_folder_id, &move |f| {
            let mut f = f.clone();
            f.entries.retain(|e| e.id != entry_id);
            f
        });
        let entry_for_insert = entry.clone();
        let next = Self::mutate_folder(&next, target_category_id, target_folder_id, &move |f| {
            let mut f = f.clone();
            f.entries.push(entry_for_insert.clone());
            f
        });

        session.vault = activity_log::record(
            &touch_vault(&next),
            "entry.moved",
            json!({ "entryId": entry_id, "targetCategoryId": target_category_id, "targetFolderId": target_folder_id }),
        );
        self.persist()?;
        self.push_event(
            "entry.moved",
            json!({ "entryId": entry_id, "targetCategoryId": target_category_id, "targetFolderId": target_folder_id }),
        );
        Ok(())
    }

    pub fn duplicate_entry_by_id(&mut self, entry_id: &str) -> Result<Entry, VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let (category_id, folder_id, entry) =
            Self::locate_entry(&session.vault, entry_id).ok_or(VaultServiceError::EntryNotFound)?;
        let copy = duplicate_entry(&entry);
        let copy_for_insert = copy.clone();
        let next = Self::mutate_folder(&session.vault, &category_id, &folder_id, &move |f| {
            let mut f = f.clone();
            f.entries.push(copy_for_insert.clone());
            f
        });
        session.vault = activity_log::record(&touch_vault(&next), "entry.duplicated", json!({ "entryId": entry_id, "copyId": copy.id }));
        self.persist()?;
        self.push_event("entry.duplicated", json!({ "entryId": entry_id, "copyId": copy.id }));
        Ok(copy)
    }

    pub fn toggle_favorite(&mut self, entry_id: &str) -> Result<Entry, VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let (category_id, folder_id, entry) =
            Self::locate_entry(&session.vault, entry_id).ok_or(VaultServiceError::EntryNotFound)?;
        let updated = apply_entry_update(&entry, EntryUpdate { favorite: Some(!entry.favorite), ..Default::default() })?;

        let u = updated.clone();
        let next = Self::mutate_folder(&session.vault, &category_id, &folder_id, &move |f| {
            let mut f = f.clone();
            for e in &mut f.entries {
                if e.id == entry_id {
                    *e = u.clone();
                }
            }
            f
        });
        session.vault = touch_vault(&next);
        self.persist()?;
        self.push_event("entry.favoriteToggled", json!({ "entryId": entry_id, "favorite": updated.favorite }));
        Ok(updated)
    }

    pub fn list_favorites(&self) -> Result<Vec<Entry>, VaultServiceError> {
        let vault = &self.require_unlocked()?.vault;
        let mut favorites = Vec::new();
        fn walk(folder: &Folder, out: &mut Vec<Entry>) {
            out.extend(folder.entries.iter().filter(|e| e.favorite).cloned());
            folder.folders.iter().for_each(|f| walk(f, out));
        }
        for category in &vault.categories {
            category.folders.iter().for_each(|f| walk(f, &mut favorites));
        }
        Ok(favorites)
    }

    /// The `limit` most recently created/edited entries, newest first.
    /// Sorts on the updatedAt RFC3339 string directly - fixed-width,
    /// zero-padded, UTC timestamps sort identically whether compared
    /// lexicographically or chronologically, so no date parsing is needed.
    pub fn list_recent_entries(&self, limit: usize) -> Result<Vec<Entry>, VaultServiceError> {
        let vault = &self.require_unlocked()?.vault;
        let mut all = Vec::new();
        fn walk(folder: &Folder, out: &mut Vec<Entry>) {
            out.extend(folder.entries.iter().cloned());
            folder.folders.iter().for_each(|f| walk(f, out));
        }
        for category in &vault.categories {
            category.folders.iter().for_each(|f| walk(f, &mut all));
        }
        all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        all.truncate(limit);
        Ok(all)
    }

    pub fn list_recent_activity(&self, limit: usize) -> Result<Vec<crate::model::ActivityLogEntry>, VaultServiceError> {
        let vault = &self.require_unlocked()?.vault;
        Ok(activity_log::list(vault, limit))
    }

    /// Groups entries that share the same password field value. Returns
    /// only enough to locate each entry in the UI, never the shared
    /// password value itself.
    pub fn find_reused_passwords(&self) -> Result<Vec<Vec<ReusedPasswordEntry>>, VaultServiceError> {
        let vault = &self.require_unlocked()?.vault;
        let mut by_password: std::collections::HashMap<String, Vec<ReusedPasswordEntry>> = std::collections::HashMap::new();

        fn walk(folder: &Folder, category_name: &str, folder_path: &str, by_password: &mut std::collections::HashMap<String, Vec<ReusedPasswordEntry>>) {
            for entry in &folder.entries {
                let Some(password_field) = entry.fields.iter().find(|f| f.field_type == "password" && !f.value.is_empty()) else {
                    continue;
                };
                by_password.entry(password_field.value.clone()).or_default().push(ReusedPasswordEntry {
                    id: entry.id.clone(),
                    title: entry.title.clone(),
                    category_name: category_name.to_string(),
                    folder_path: folder_path.to_string(),
                });
            }
            for sub in &folder.folders {
                walk(sub, category_name, &format!("{folder_path}/{}", sub.name), by_password);
            }
        }

        for category in &vault.categories {
            for folder in &category.folders {
                walk(folder, &category.name, &folder.name, &mut by_password);
            }
        }

        Ok(by_password.into_values().filter(|group| group.len() > 1).collect())
    }

    /// Records a renderer-side error into the activity log. A no-op while
    /// locked.
    pub fn record_error(&mut self, message: &str, stack: &str) {
        let Some(session) = self.session.as_mut() else { return };
        session.vault = activity_log::record(&touch_vault(&session.vault), "app.error", json!({ "message": message, "stack": stack }));
        if self.persist().is_ok() {
            self.push_event("app.error", json!({ "message": message, "stack": stack }));
        }
    }

    // ---- recycle bin ---------------------------------------------------

    pub fn restore_from_recycle_bin(&mut self, recycle_id: &str) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let record = recycle_bin::find_record(&session.vault, recycle_id)
            .cloned()
            .ok_or(VaultServiceError::RecycleBinItemNotFound)?;

        let mut next = session.vault.clone();
        let record_type;
        match &record {
            RecycleBinRecord::Category { item, .. } => {
                record_type = "category";
                next.categories.push(item.clone());
            }
            RecycleBinRecord::Folder { item, category_id, .. } => {
                record_type = "folder";
                if !next.categories.iter().any(|c| &c.id == category_id) {
                    return Err(VaultServiceError::OriginalCategoryGone);
                }
                for cat in &mut next.categories {
                    if &cat.id == category_id {
                        cat.folders.push(item.clone());
                    }
                }
            }
            RecycleBinRecord::Entry { item, category_id, folder_id, .. } => {
                record_type = "entry";
                if Self::locate_folder(&next, folder_id).is_none() {
                    return Err(VaultServiceError::OriginalFolderGone);
                }
                let it = item.clone();
                next = Self::mutate_folder(&next, category_id, folder_id, &move |f| {
                    let mut f = f.clone();
                    f.entries.push(it.clone());
                    f
                });
            }
        }

        let next = recycle_bin::remove_record(&touch_vault(&next), recycle_id);
        session.vault = activity_log::record(&next, "recycleBin.restored", json!({ "recycleId": recycle_id, "type": record_type }));
        self.persist()?;
        self.push_event("recycleBin.restored", json!({ "recycleId": recycle_id, "type": record_type }));
        Ok(())
    }

    pub fn permanently_delete(&mut self, recycle_id: &str) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let next = recycle_bin::remove_record(&session.vault, recycle_id);
        session.vault = activity_log::record(&touch_vault(&next), "recycleBin.permanentlyDeleted", json!({ "recycleId": recycle_id }));
        self.persist()?;
        self.push_event("recycleBin.permanentlyDeleted", json!({ "recycleId": recycle_id }));
        Ok(())
    }

    pub fn empty_recycle_bin(&mut self) -> Result<(), VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let next = recycle_bin::clear(&session.vault);
        session.vault = activity_log::record(&touch_vault(&next), "recycleBin.emptied", json!({}));
        self.persist()?;
        self.push_event("recycleBin.emptied", json!({}));
        Ok(())
    }

    // ---- settings --------------------------------------------------------

    pub fn get_settings(&self) -> Result<&Settings, VaultServiceError> {
        Ok(&self.require_unlocked()?.vault.settings)
    }

    pub fn update_vault_settings(&mut self, updates: SettingsUpdate) -> Result<Settings, VaultServiceError> {
        let session = self.require_unlocked_mut()?;
        let updated = settings_service::update(&session.vault.settings, updates)?;
        let mut next = session.vault.clone();
        next.settings = updated.clone();
        session.vault = touch_vault(&next);
        self.persist()?;
        self.push_event("settings.updated", json!({}));
        Ok(updated)
    }

    // ---- import / export --------------------------------------------------

    pub fn export_vault_to(&mut self, dest_path: &Path) -> Result<(), VaultServiceError> {
        self.require_unlocked()?;
        self.persist()?; // ensure the file on disk reflects the in-memory state first
        vault_repository::export_to(&self.vault_file_path, dest_path)?;
        Ok(())
    }

    /// Replaces the live vault with an external .xam file after verifying
    /// it can be decrypted with the provided password. The current vault
    /// is backed up first so the operation is reversible.
    pub fn import_vault_from(&mut self, source_path: &Path, password: &str) -> Result<(), VaultServiceError> {
        let unlocked = vault_repository::import_from::<Vault>(source_path, password)?; // errors if wrong password
        if !is_vault_valid(&unlocked.vault) {
            return Err(VaultServiceError::ImportFileInvalid);
        }

        let keep_count = if unlocked.vault.settings.backup_count > 0 { unlocked.vault.settings.backup_count as usize } else { 5 };
        vault_repository::replace_live_file(source_path, &self.vault_file_path, &self.backup_dir, keep_count)?;

        if let Some(session) = self.session.as_mut() {
            session.session_key.iter_mut().for_each(|b| *b = 0);
            session.salt.iter_mut().for_each(|b| *b = 0);
        }
        let vault = activity_log::record(&touch_vault(&unlocked.vault), "vault.imported", json!({}));
        self.session = Some(Session { session_key: unlocked.session_key.to_vec(), salt: unlocked.salt, vault });
        self.persist()?;
        self.invalidate_quick_unlock();
        self.push_event("vault.imported", json!({}));
        Ok(())
    }

    // ---- backups ------------------------------------------------------------

    pub fn list_backups(&self) -> Vec<PathBuf> {
        vault_repository::list_backups(&self.backup_dir)
    }

    /// Deliberately callable while locked (or even while the live vault
    /// file is unreadable/corrupted) - this is the whole point of it as a
    /// recovery path.
    pub fn restore_backup(&mut self, backup_path: &Path) -> Result<(), VaultServiceError> {
        let keep_count = if self.is_unlocked() { self.get_settings()?.backup_count.max(0) as usize } else { 5 };
        vault_repository::restore_backup(backup_path, &self.vault_file_path, &self.backup_dir, keep_count)?;
        if self.is_unlocked() {
            self.lock();
        }
        self.invalidate_quick_unlock();
        Ok(())
    }

    pub fn delete_backup(&self, backup_path: &Path) -> Result<(), VaultServiceError> {
        vault_repository::delete_backup(backup_path)?;
        Ok(())
    }

    pub fn rename_backup(&self, backup_path: &Path, new_label: &str) -> Result<PathBuf, VaultServiceError> {
        Ok(vault_repository::rename_backup(backup_path, new_label, &self.backup_dir)?)
    }

    pub fn export_backup_to(&self, backup_path: &Path, dest_path: &Path) -> Result<(), VaultServiceError> {
        vault_repository::export_backup_to(backup_path, dest_path)?;
        Ok(())
    }

    // ---- search ------------------------------------------------------------

    pub fn search(&self, query: &str) -> Result<Vec<SearchResult>, VaultServiceError> {
        let vault = &self.require_unlocked()?.vault;
        Ok(search::search(vault, query))
    }
}

/// Field data as sent over IPC for update_entry_fields: the renderer
/// always sends complete field objects (see EntryForm.jsx), not deltas -
/// see the comment on Field::created_at for why timestamps are optional.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct IncomingField {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub value: String,
    pub hidden: bool,
}

impl IncomingField {
    /// Used verbatim as the persisted field when it doesn't match any
    /// existing field id (a brand-new field the UI appended) - mirrors
    /// the JS `if (!existing) return incoming;` passthrough exactly,
    /// including the lack of createdAt/updatedAt until next edit.
    fn into_field(self) -> Field {
        Field {
            id: self.id,
            label: self.label,
            field_type: self.field_type,
            value: self.value,
            hidden: self.hidden,
            history: Vec::new(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryFieldsUpdate {
    pub title: Option<String>,
    pub template: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub fields: Option<Vec<IncomingField>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quick_unlock::test_support::FakeKeyring;
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dirs() -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!(
            "xela-vaultservice-test-{}-{}",
            process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&base).unwrap();
        (base.join("vault.xam"), base.join("backups"))
    }

    fn new_service() -> VaultService {
        let (vault_file_path, backup_dir) = temp_dirs();
        let quick_unlock_file_path = Some(vault_file_path.with_file_name("quickunlock.dat"));
        VaultService::new(
            VaultServiceConfig { vault_file_path, backup_dir, quick_unlock_file_path },
            Box::new(FakeKeyring::new()),
        )
    }

    fn unlocked_service() -> VaultService {
        let mut svc = new_service();
        svc.create("correct horse battery staple").unwrap();
        svc
    }

    #[test]
    fn create_then_lock_then_unlock_round_trips() {
        let mut svc = unlocked_service();
        assert!(svc.is_unlocked());
        svc.lock();
        assert!(!svc.is_unlocked());
        assert!(svc.get_vault().is_err());

        svc.unlock("correct horse battery staple").unwrap();
        assert!(svc.is_unlocked());
        assert!(svc.get_vault().unwrap().categories.is_empty());
    }

    #[test]
    fn create_rejects_short_password_and_double_creation() {
        let mut svc = new_service();
        assert!(matches!(svc.create("short"), Err(VaultServiceError::MasterPasswordTooShort)));
        svc.create("correct horse battery staple").unwrap();
        assert!(matches!(svc.create("another long password"), Err(VaultServiceError::VaultAlreadyExists)));
    }

    #[test]
    fn unlock_rejects_wrong_password() {
        let mut svc = unlocked_service();
        svc.lock();
        assert!(svc.unlock("wrong password entirely").is_err());
    }

    #[test]
    fn mutating_while_locked_is_rejected() {
        let mut svc = unlocked_service();
        svc.lock();
        assert!(matches!(svc.add_category("Personal", None), Err(VaultServiceError::Locked)));
    }

    #[test]
    fn category_lifecycle_recycles_on_delete() {
        let mut svc = unlocked_service();
        let category = svc.add_category("Personal", Some("home")).unwrap();
        assert_eq!(svc.get_vault().unwrap().categories.len(), 1);

        svc.rename_category(&category.id, "Personal Stuff").unwrap();
        assert_eq!(svc.get_vault().unwrap().categories[0].name, "Personal Stuff");

        svc.delete_category(&category.id).unwrap();
        assert!(svc.get_vault().unwrap().categories.is_empty());
        assert_eq!(svc.get_vault().unwrap().recycle_bin.len(), 1);
    }

    #[test]
    fn folder_lifecycle_add_rename_move_delete() {
        let mut svc = unlocked_service();
        let cat_a = svc.add_category("A", None).unwrap();
        let cat_b = svc.add_category("B", None).unwrap();
        let folder = svc.add_folder(&cat_a.id, None, "Logins").unwrap();
        let sub = svc.add_folder(&cat_a.id, Some(&folder.id), "Sub").unwrap();

        svc.rename_folder(&cat_a.id, &folder.id, "Logins Renamed").unwrap();
        let vault = svc.get_vault().unwrap();
        assert_eq!(vault.categories.iter().find(|c| c.id == cat_a.id).unwrap().folders[0].name, "Logins Renamed");
        assert_eq!(vault.categories.iter().find(|c| c.id == cat_a.id).unwrap().folders[0].folders[0].id, sub.id);

        svc.move_folder(&sub.id, &cat_b.id, None, None).unwrap();
        let vault = svc.get_vault().unwrap();
        let cat_a_after = vault.categories.iter().find(|c| c.id == cat_a.id).unwrap();
        let cat_b_after = vault.categories.iter().find(|c| c.id == cat_b.id).unwrap();
        assert!(cat_a_after.folders[0].folders.is_empty());
        assert_eq!(cat_b_after.folders.len(), 1);
        assert_eq!(cat_b_after.folders[0].id, sub.id);

        svc.delete_folder(&cat_a.id, &folder.id).unwrap();
        let vault = svc.get_vault().unwrap();
        assert!(vault.categories.iter().find(|c| c.id == cat_a.id).unwrap().folders.is_empty());
        assert_eq!(vault.recycle_bin.len(), 1);
    }

    #[test]
    fn folder_not_found_and_category_not_found_errors() {
        let mut svc = unlocked_service();
        assert!(matches!(svc.add_folder("nope", None, "X"), Err(VaultServiceError::CategoryNotFound)));
        // Matches VaultService.js's renameFolder exactly: mutateFolder()
        // silently no-ops when nothing matches, there's no existence
        // check, so this "succeeds" without changing anything.
        assert!(svc.rename_folder("cat", "nope", "X").is_ok());
        let cat = svc.add_category("A", None).unwrap();
        assert!(matches!(svc.delete_folder(&cat.id, "nope"), Err(VaultServiceError::FolderNotFound)));
    }

    fn setup_entry(svc: &mut VaultService) -> (Category, Folder, Entry) {
        let cat = svc.add_category("Personal", None).unwrap();
        let folder = svc.add_folder(&cat.id, None, "Logins").unwrap();
        let entry = svc
            .add_entry(&cat.id, &folder.id, CreateEntryOptions { title: "Gmail".into(), template: "Login".into(), ..Default::default() })
            .unwrap();
        (cat, folder, entry)
    }

    #[test]
    fn entry_crud_lifecycle() {
        let mut svc = unlocked_service();
        let (cat, folder, entry) = setup_entry(&mut svc);
        assert_eq!(entry.fields.len(), 3); // Login template: Username/Password/Website

        let updated = svc
            .update_entry_fields(
                &entry.id,
                EntryFieldsUpdate { title: Some("Gmail Primary".into()), ..Default::default() },
            )
            .unwrap();
        assert_eq!(updated.title, "Gmail Primary");

        let favorited = svc.toggle_favorite(&entry.id).unwrap();
        assert!(favorited.favorite);
        assert_eq!(svc.list_favorites().unwrap().len(), 1);

        let dup = svc.duplicate_entry_by_id(&entry.id).unwrap();
        assert_eq!(dup.title, "Gmail Primary (Copy)");
        assert_ne!(dup.id, entry.id);

        let cat2 = svc.add_category("Work", None).unwrap();
        let folder2 = svc.add_folder(&cat2.id, None, "Work Logins").unwrap();
        svc.move_entry(&entry.id, &cat2.id, &folder2.id).unwrap();
        let vault = svc.get_vault().unwrap();
        let moved_folder = vault.categories.iter().find(|c| c.id == cat2.id).unwrap().folders.iter().find(|f| f.id == folder2.id).unwrap();
        assert!(moved_folder.entries.iter().any(|e| e.id == entry.id));
        let old_folder = vault.categories.iter().find(|c| c.id == cat.id).unwrap().folders.iter().find(|f| f.id == folder.id).unwrap();
        assert!(!old_folder.entries.iter().any(|e| e.id == entry.id));

        svc.delete_entry(&dup.id).unwrap();
        assert_eq!(svc.get_vault().unwrap().recycle_bin.len(), 1);
    }

    #[test]
    fn update_entry_fields_computes_password_history_on_value_change() {
        let mut svc = unlocked_service();
        let (cat, folder, entry) = setup_entry(&mut svc);
        let password_field = entry.fields.iter().find(|f| f.field_type == "password").unwrap().clone();

        let incoming: Vec<IncomingField> = entry
            .fields
            .iter()
            .map(|f| {
                let value = if f.id == password_field.id { "new-password-value".to_string() } else { f.value.clone() };
                IncomingField { id: f.id.clone(), label: f.label.clone(), field_type: f.field_type.clone(), value, hidden: f.hidden }
            })
            .collect();

        let updated = svc.update_entry_fields(&entry.id, EntryFieldsUpdate { fields: Some(incoming), ..Default::default() }).unwrap();
        let updated_password_field = updated.fields.iter().find(|f| f.id == password_field.id).unwrap();
        assert_eq!(updated_password_field.value, "new-password-value");
        assert_eq!(updated_password_field.history.len(), 1);
        assert_eq!(updated_password_field.history[0].value, ""); // original value was empty
        let _ = (cat, folder);
    }

    #[test]
    fn update_entry_fields_accepts_a_brand_new_field_with_client_temp_id() {
        let mut svc = unlocked_service();
        let (_, _, entry) = setup_entry(&mut svc);
        let mut incoming: Vec<IncomingField> = entry
            .fields
            .iter()
            .map(|f| IncomingField { id: f.id.clone(), label: f.label.clone(), field_type: f.field_type.clone(), value: f.value.clone(), hidden: f.hidden })
            .collect();
        incoming.push(IncomingField { id: "new-1234-0".into(), label: "Custom".into(), field_type: "text".into(), value: "hi".into(), hidden: false });

        let updated = svc.update_entry_fields(&entry.id, EntryFieldsUpdate { fields: Some(incoming), ..Default::default() }).unwrap();
        let new_field = updated.fields.iter().find(|f| f.id == "new-1234-0").unwrap();
        assert_eq!(new_field.value, "hi");
        assert_eq!(new_field.created_at, ""); // passthrough, no timestamp minted
    }

    #[test]
    fn recycle_bin_restore_for_category_folder_and_entry() {
        let mut svc = unlocked_service();
        let (cat, folder, entry) = setup_entry(&mut svc);

        svc.delete_entry(&entry.id).unwrap();
        let recycle_id = svc.get_vault().unwrap().recycle_bin[0].id().to_string();
        svc.restore_from_recycle_bin(&recycle_id).unwrap();
        let vault = svc.get_vault().unwrap();
        let restored_folder = vault.categories.iter().find(|c| c.id == cat.id).unwrap().folders.iter().find(|f| f.id == folder.id).unwrap();
        assert!(restored_folder.entries.iter().any(|e| e.id == entry.id));
        assert!(vault.recycle_bin.is_empty());

        svc.delete_folder(&cat.id, &folder.id).unwrap();
        let recycle_id = svc.get_vault().unwrap().recycle_bin[0].id().to_string();
        svc.restore_from_recycle_bin(&recycle_id).unwrap();
        assert_eq!(svc.get_vault().unwrap().categories.iter().find(|c| c.id == cat.id).unwrap().folders.len(), 1);

        svc.delete_category(&cat.id).unwrap();
        let recycle_id = svc.get_vault().unwrap().recycle_bin[0].id().to_string();
        svc.restore_from_recycle_bin(&recycle_id).unwrap();
        assert!(svc.get_vault().unwrap().categories.iter().any(|c| c.id == cat.id));
    }

    #[test]
    fn permanently_delete_and_empty_recycle_bin() {
        let mut svc = unlocked_service();
        let (cat, _, _) = setup_entry(&mut svc);
        svc.delete_category(&cat.id).unwrap();
        let recycle_id = svc.get_vault().unwrap().recycle_bin[0].id().to_string();

        svc.permanently_delete(&recycle_id).unwrap();
        assert!(svc.get_vault().unwrap().recycle_bin.is_empty());

        svc.delete_category(&cat.id).unwrap_err(); // already gone, but let's add another to test empty()
        let cat2 = svc.add_category("Another", None).unwrap();
        svc.delete_category(&cat2.id).unwrap();
        assert_eq!(svc.get_vault().unwrap().recycle_bin.len(), 1);
        svc.empty_recycle_bin().unwrap();
        assert!(svc.get_vault().unwrap().recycle_bin.is_empty());
    }

    #[test]
    fn find_reused_passwords_groups_entries_sharing_a_value() {
        let mut svc = unlocked_service();
        let cat = svc.add_category("Personal", None).unwrap();
        let folder = svc.add_folder(&cat.id, None, "Logins").unwrap();
        let e1 = svc.add_entry(&cat.id, &folder.id, CreateEntryOptions { title: "Site A".into(), template: "Login".into(), ..Default::default() }).unwrap();
        let e2 = svc.add_entry(&cat.id, &folder.id, CreateEntryOptions { title: "Site B".into(), template: "Login".into(), ..Default::default() }).unwrap();

        for entry in [&e1, &e2] {
            let pw_field = entry.fields.iter().find(|f| f.field_type == "password").unwrap();
            let incoming: Vec<IncomingField> = entry
                .fields
                .iter()
                .map(|f| {
                    let value = if f.id == pw_field.id { "shared-password".to_string() } else { f.value.clone() };
                    IncomingField { id: f.id.clone(), label: f.label.clone(), field_type: f.field_type.clone(), value, hidden: f.hidden }
                })
                .collect();
            svc.update_entry_fields(&entry.id, EntryFieldsUpdate { fields: Some(incoming), ..Default::default() }).unwrap();
        }

        let groups = svc.find_reused_passwords().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 2);
    }

    #[test]
    fn settings_update_validates_and_rejects_bad_values() {
        let mut svc = unlocked_service();
        let updated = svc
            .update_vault_settings(SettingsUpdate { theme: Some("dark".into()), ..Default::default() })
            .unwrap();
        assert_eq!(updated.theme, "dark");

        let err = svc.update_vault_settings(SettingsUpdate { backup_count: Some(0), ..Default::default() });
        assert!(err.is_err());
        // Rejected update must not have mutated anything.
        assert_eq!(svc.get_settings().unwrap().theme, "dark");
    }

    #[test]
    fn search_finds_entries_by_title() {
        let mut svc = unlocked_service();
        setup_entry(&mut svc);
        let results = svc.search("Gmail").unwrap();
        assert_eq!(results.len(), 1);
        assert!(svc.search("").unwrap().is_empty());
    }

    #[test]
    fn change_master_password_invalidates_old_and_allows_new() {
        let mut svc = unlocked_service();
        svc.change_master_password("correct horse battery staple", "new master password 42").unwrap();
        svc.lock();

        assert!(svc.unlock("correct horse battery staple").is_err());
        svc.unlock("new master password 42").unwrap();
        assert!(svc.is_unlocked());
    }

    #[test]
    fn change_master_password_rejects_wrong_current_password() {
        let mut svc = unlocked_service();
        assert!(matches!(
            svc.change_master_password("wrong current password", "new master password 42"),
            Err(VaultServiceError::CurrentPasswordIncorrect)
        ));
    }

    #[test]
    fn export_and_import_vault_round_trip() {
        let mut svc = unlocked_service();
        setup_entry(&mut svc);
        let export_dir = std::env::temp_dir().join(format!("xela-export-test-{}", process::id()));
        std::fs::create_dir_all(&export_dir).unwrap();
        let export_path = export_dir.join("exported.xam");
        svc.export_vault_to(&export_path).unwrap();
        assert!(export_path.exists());

        let mut svc2 = new_service();
        svc2.import_vault_from(&export_path, "correct horse battery staple").unwrap();
        assert!(svc2.is_unlocked());
        assert_eq!(svc2.get_vault().unwrap().categories.len(), 1);
    }

    #[test]
    fn backups_list_restore_rename_delete() {
        let mut svc = unlocked_service();
        svc.add_category("A", None).unwrap(); // triggers a backup rotation on the 2nd save
        svc.add_category("B", None).unwrap();
        let backups = svc.list_backups();
        assert!(!backups.is_empty());

        let renamed = svc.rename_backup(&backups[0], "my-label").unwrap();
        assert!(renamed.to_string_lossy().contains("my-label"));

        let export_dir = std::env::temp_dir().join(format!("xela-backup-export-test-{}", process::id()));
        std::fs::create_dir_all(&export_dir).unwrap();
        let export_path = export_dir.join("backup-export.xam");
        svc.export_backup_to(&renamed, &export_path).unwrap();
        assert!(export_path.exists());

        svc.restore_backup(&renamed).unwrap();
        assert!(!svc.is_unlocked()); // restore_backup locks an unlocked session

        svc.delete_backup(&renamed).unwrap();
        assert!(!svc.list_backups().contains(&renamed));
    }

    #[test]
    fn quick_unlock_enable_and_pin_unlock_round_trip() {
        let mut svc = unlocked_service();
        assert!(svc.is_quick_unlock_available());
        assert!(!svc.is_quick_unlock_enabled());

        svc.enable_quick_unlock("4242").unwrap();
        assert!(svc.is_quick_unlock_enabled());
        svc.lock();

        svc.unlock_with_pin("4242").unwrap();
        assert!(svc.is_unlocked());
    }

    #[test]
    fn quick_unlock_disabled_after_master_password_change() {
        let mut svc = unlocked_service();
        svc.enable_quick_unlock("4242").unwrap();
        svc.change_master_password("correct horse battery staple", "brand new password 99").unwrap();
        assert!(!svc.is_quick_unlock_enabled());
    }

    #[test]
    fn events_are_recorded_and_drainable() {
        let mut svc = unlocked_service();
        let events_after_create = svc.drain_events();
        assert!(events_after_create.iter().any(|e| e.action == "vault.created"));

        svc.add_category("Personal", None).unwrap();
        let events = svc.drain_events();
        assert!(events.iter().any(|e| e.action == "category.created"));
        // Drained already - a second drain should be empty.
        assert!(svc.drain_events().is_empty());
    }
}
