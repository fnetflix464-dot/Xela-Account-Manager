// Rust port of src/repositories/VaultRepository.js - the only place that
// touches disk or encryption directly. Ties crypto.rs (encrypt/decrypt),
// vault_file.rs (envelope + atomic write), and backup.rs (rotation)
// together behind a `{ vault, session_key, salt }` shaped API.

#![allow(dead_code)]

use crate::backup::{self, BackupError};
use crate::crypto::{self, CryptoError};
use crate::vault_file::{self, FileError, VaultEnvelopeFields};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum RepositoryError {
    #[error(transparent)]
    File(#[from] FileError),
    #[error(transparent)]
    Backup(#[from] BackupError),
    #[error(transparent)]
    Crypto(#[from] CryptoError),
    #[error("Quick unlock data is out of date - unlock with your master password, then re-enable it")]
    StaleQuickUnlockKey,
}

pub struct Unlocked<V> {
    pub vault: V,
    pub session_key: [u8; crypto::KEY_LENGTH],
    pub salt: Vec<u8>,
}

pub fn exists(vault_file_path: &Path) -> bool {
    vault_file::path_exists(vault_file_path)
}

pub fn is_structurally_valid(vault_file_path: &Path) -> bool {
    vault_file::is_vault_file_structurally_valid(vault_file_path)
}

/// Derives a brand-new key/salt pair for a master password (first-time
/// vault creation, or a master-password change).
pub fn derive_new_key(master_password: &str) -> Result<([u8; crypto::KEY_LENGTH], Vec<u8>), RepositoryError> {
    let salt = crypto::generate_salt();
    let session_key = crypto::derive_key(master_password, &salt)?;
    Ok((session_key, salt))
}

/// Verifies a candidate password against the currently-active session key,
/// without touching disk.
pub fn verify_key(candidate_password: &str, salt: &[u8], session_key: &[u8]) -> bool {
    match crypto::derive_key(candidate_password, salt) {
        Ok(candidate_key) => candidate_key.as_slice() == session_key,
        Err(_) => false,
    }
}

/// Persists a vault object to disk: rotates a backup of whatever was there
/// before, then encrypts + atomically writes the new state.
pub fn save<V: Serialize>(
    vault_file_path: &Path,
    backup_dir: &Path,
    vault: &V,
    session_key: &[u8],
    salt: &[u8],
    backup_keep_count: usize,
) -> Result<(), RepositoryError> {
    backup::create_backup(vault_file_path, backup_dir, backup_keep_count)?;
    let payload = crypto::encrypt_object(vault, session_key)?;
    vault_file::write_vault_file(
        vault_file_path,
        VaultEnvelopeFields {
            salt: BASE64.encode(salt),
            iv: payload.iv,
            auth_tag: payload.auth_tag,
            ciphertext: payload.ciphertext,
        },
    )?;
    Ok(())
}

/// Creates the on-disk vault file for a brand-new vault.
pub fn create<V: Serialize>(
    vault_file_path: &Path,
    backup_dir: &Path,
    master_password: &str,
    vault: &V,
) -> Result<([u8; crypto::KEY_LENGTH], Vec<u8>), RepositoryError> {
    let (session_key, salt) = derive_new_key(master_password)?;
    save(vault_file_path, backup_dir, vault, &session_key, &salt, 10)?;
    Ok((session_key, salt))
}

/// Reads + decrypts the vault file at `vault_file_path`. Errors if the
/// password is wrong or the file is missing/corrupted.
pub fn load<V: DeserializeOwned>(
    vault_file_path: &Path,
    master_password: &str,
) -> Result<Unlocked<V>, RepositoryError> {
    let envelope = vault_file::read_vault_file(vault_file_path)?;
    let salt = BASE64
        .decode(&envelope.salt)
        .map_err(|_| FileError::MissingFields)?;
    let session_key = crypto::derive_key(master_password, &salt)?;
    let payload = crypto::EncryptedPayload::from(&envelope);
    let vault: V = crypto::decrypt_object(&payload, &session_key)?; // errors if wrong password
    Ok(Unlocked { vault, session_key, salt })
}

/// Reads + decrypts the vault file using an already-known session key/salt
/// pair (PIN quick-unlock path) instead of deriving the key from a
/// password. Verifies the salt matches what's in the file first: a
/// mismatch means the key material is stale (master password changed, or
/// the vault was restored/imported since).
pub fn load_with_key<V: DeserializeOwned>(
    vault_file_path: &Path,
    session_key: &[u8],
    salt: &[u8],
) -> Result<Unlocked<V>, RepositoryError> {
    let envelope = vault_file::read_vault_file(vault_file_path)?;
    let file_salt = BASE64
        .decode(&envelope.salt)
        .map_err(|_| FileError::MissingFields)?;
    if file_salt != salt {
        return Err(RepositoryError::StaleQuickUnlockKey);
    }
    let payload = crypto::EncryptedPayload::from(&envelope);
    let vault: V = crypto::decrypt_object(&payload, session_key)?;
    Ok(Unlocked {
        vault,
        session_key: session_key.try_into().map_err(|_| CryptoError::InvalidKeyLength)?,
        salt: salt.to_vec(),
    })
}

/// Copies the live vault file to `dest_path` (export). Assumes the caller
/// has already persisted the latest in-memory state.
pub fn export_to(vault_file_path: &Path, dest_path: &Path) -> Result<(), RepositoryError> {
    vault_file::copy_file(vault_file_path, dest_path).map_err(FileError::Io)?;
    Ok(())
}

/// Reads + decrypts an external vault file (import candidate) without
/// touching the live vault file. Errors if the password is wrong.
pub fn import_from<V: DeserializeOwned>(source_path: &Path, password: &str) -> Result<Unlocked<V>, RepositoryError> {
    load(source_path, password)
}

/// Replaces the live vault file with `source_path` (backing up the current
/// live file first, if any).
pub fn replace_live_file(
    source_path: &Path,
    vault_file_path: &Path,
    backup_dir: &Path,
    keep_count: usize,
) -> Result<(), RepositoryError> {
    if exists(vault_file_path) {
        backup::create_backup(vault_file_path, backup_dir, keep_count)?;
    }
    vault_file::copy_file(source_path, vault_file_path).map_err(FileError::Io)?;
    Ok(())
}

pub fn list_backups(backup_dir: &Path) -> Vec<PathBuf> {
    backup::list_backups(backup_dir)
}

pub fn restore_backup(
    backup_path: &Path,
    vault_file_path: &Path,
    backup_dir: &Path,
    keep_count: usize,
) -> Result<(), RepositoryError> {
    backup::restore_backup(backup_path, vault_file_path, backup_dir, keep_count)?;
    Ok(())
}

pub fn delete_backup(backup_path: &Path) -> Result<(), RepositoryError> {
    backup::delete_backup(backup_path)?;
    Ok(())
}

pub fn rename_backup(backup_path: &Path, new_label: &str, backup_dir: &Path) -> Result<PathBuf, RepositoryError> {
    Ok(backup::rename_backup(backup_path, new_label, backup_dir)?)
}

pub fn export_backup_to(backup_path: &Path, dest_path: &Path) -> Result<(), RepositoryError> {
    backup::export_backup_to(backup_path, dest_path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::json;
    use std::fs;
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct SampleVault {
        categories: Vec<serde_json::Value>,
        #[serde(rename = "recycleBin")]
        recycle_bin: Vec<serde_json::Value>,
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xela-repo-test-{label}-{}-{}",
            process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_then_load_round_trips_the_vault_object() {
        let dir = temp_dir("roundtrip");
        let vault_path = dir.join("vault.xam");
        let backup_dir = dir.join("backups");
        let vault = SampleVault {
            categories: vec![json!({ "id": "c1", "name": "Logins" })],
            recycle_bin: vec![],
        };

        create(&vault_path, &backup_dir, "correct horse battery staple", &vault).unwrap();
        let loaded: Unlocked<SampleVault> = load(&vault_path, "correct horse battery staple").unwrap();
        assert_eq!(loaded.vault, vault);
    }

    #[test]
    fn load_with_wrong_password_fails() {
        let dir = temp_dir("wrongpw");
        let vault_path = dir.join("vault.xam");
        let backup_dir = dir.join("backups");
        let vault = SampleVault { categories: vec![], recycle_bin: vec![] };
        create(&vault_path, &backup_dir, "right-password", &vault).unwrap();

        let result: Result<Unlocked<SampleVault>, _> = load(&vault_path, "wrong-password");
        assert!(result.is_err());
    }

    #[test]
    fn load_with_key_detects_stale_salt() {
        let dir = temp_dir("stale");
        let vault_path = dir.join("vault.xam");
        let backup_dir = dir.join("backups");
        let vault = SampleVault { categories: vec![], recycle_bin: vec![] };
        let (session_key, _salt) = create(&vault_path, &backup_dir, "password", &vault).unwrap();

        let wrong_salt = crypto::generate_salt();
        let result: Result<Unlocked<SampleVault>, _> = load_with_key(&vault_path, &session_key, &wrong_salt);
        assert!(matches!(result, Err(RepositoryError::StaleQuickUnlockKey)));
    }

    #[test]
    fn save_rotates_a_backup_of_the_previous_state() {
        let dir = temp_dir("save");
        let vault_path = dir.join("vault.xam");
        let backup_dir = dir.join("backups");
        let v1 = SampleVault { categories: vec![], recycle_bin: vec![] };
        let (key, salt) = create(&vault_path, &backup_dir, "password", &v1).unwrap();

        let v2 = SampleVault {
            categories: vec![json!({ "id": "c2" })],
            recycle_bin: vec![],
        };
        save(&vault_path, &backup_dir, &v2, &key, &salt, 10).unwrap();

        assert_eq!(list_backups(&backup_dir).len(), 1);
        let loaded: Unlocked<SampleVault> = load(&vault_path, "password").unwrap();
        assert_eq!(loaded.vault, v2);
    }

    /// The one requirement that actually matters for this migration: a
    /// vault.xam file produced by the real (unmodified) Node CryptoService
    /// + FileService must be readable - and importable - by this Rust port,
    ///   byte for byte, no reimplementation drift.
    #[test]
    fn reads_and_imports_a_real_vault_file_written_by_the_node_app() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample-vault.xam");
        assert!(fixture.exists(), "fixture missing - regenerate via the repo's fixture script");

        #[derive(Debug, Deserialize, PartialEq)]
        struct Field {
            id: String,
            label: String,
            value: String,
            hidden: bool,
        }
        #[derive(Debug, Deserialize, PartialEq)]
        struct Entry {
            id: String,
            title: String,
            fields: Vec<Field>,
            favorite: bool,
        }
        #[derive(Debug, Deserialize, PartialEq)]
        struct Category {
            id: String,
            name: String,
            icon: String,
            folders: Vec<serde_json::Value>,
            entries: Vec<Entry>,
        }
        #[derive(Debug, Deserialize, PartialEq)]
        struct FixtureVault {
            categories: Vec<Category>,
            #[serde(rename = "recycleBin")]
            recycle_bin: Vec<serde_json::Value>,
            settings: serde_json::Value,
            #[serde(rename = "activityLog")]
            activity_log: Vec<serde_json::Value>,
        }

        // 1. Direct read via load() with the known fixture password - this
        //    is the "unlock an existing vault" path.
        let loaded: Unlocked<FixtureVault> = load(&fixture, "fixture-master-password-42").unwrap();
        assert_eq!(loaded.vault.categories.len(), 1);
        assert_eq!(loaded.vault.categories[0].name, "Logins");
        assert_eq!(loaded.vault.categories[0].entries[0].title, "Example Bank");
        assert_eq!(
            loaded.vault.categories[0].entries[0].fields[1],
            Field {
                id: "f2".into(),
                label: "Password".into(),
                value: "hunter2-but-not-really".into(),
                hidden: true,
            }
        );

        // 2. The import path specifically - importFrom is just load() under
        //    a different name in the JS original, but exercise the actual
        //    entry point the IPC layer will call.
        let imported: Unlocked<FixtureVault> = import_from(&fixture, "fixture-master-password-42").unwrap();
        assert_eq!(imported.vault, loaded.vault);

        // 3. Wrong password on the same real file must fail closed.
        let bad: Result<Unlocked<FixtureVault>, _> = import_from(&fixture, "wrong-password");
        assert!(bad.is_err());
    }
}
