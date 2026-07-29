// Rust port of src/services/BackupService.js.

#![allow(dead_code)]

use crate::vault_file;
use std::path::{Path, PathBuf};

pub const BACKUP_PREFIX: &str = "vault-";
const BACKUP_SUFFIX: &str = ".xam.bak";

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("Backup file not found")]
    NotFound,
    #[error("Backup name cannot be empty")]
    EmptyName,
    #[error("A backup with that name already exists")]
    NameTaken,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

fn backup_file_name() -> String {
    let iso = vault_file_now_iso_for_filename();
    format!("{BACKUP_PREFIX}{iso}{BACKUP_SUFFIX}")
}

/// Same "now" the vault envelope's savedAt uses, but with `:`/`.` replaced
/// with `-` so it's safe as a filename component (mirrors the JS
/// `.replace(/[:.]/g, '-')` on the ISO string).
fn vault_file_now_iso_for_filename() -> String {
    crate::time_util::now_iso8601().replace([':', '.'], "-")
}

/// Creates a timestamped backup copy of the current vault file, then prunes
/// older backups beyond `keep_count`. Safe to call on every save. Returns
/// `Ok(None)` if there was nothing to back up yet (first-ever save).
pub fn create_backup(
    vault_file_path: &Path,
    backup_dir: &Path,
    keep_count: usize,
) -> Result<Option<PathBuf>, BackupError> {
    if !vault_file::path_exists(vault_file_path) {
        return Ok(None);
    }
    vault_file::ensure_dir(backup_dir)?;
    let backup_path = backup_dir.join(backup_file_name());
    vault_file::copy_file(vault_file_path, &backup_path)?;
    prune_backups(backup_dir, keep_count)?;
    Ok(Some(backup_path))
}

/// Deletes the oldest backups beyond keep_count.
pub fn prune_backups(backup_dir: &Path, keep_count: usize) -> std::io::Result<()> {
    let backups = vault_file::list_files_by_prefix(backup_dir, BACKUP_PREFIX);
    let excess = backups.len().saturating_sub(keep_count);
    for path in &backups[..excess] {
        vault_file::delete_file(path)?;
    }
    Ok(())
}

/// Lists available backups, newest first.
pub fn list_backups(backup_dir: &Path) -> Vec<PathBuf> {
    let mut backups = vault_file::list_files_by_prefix(backup_dir, BACKUP_PREFIX);
    backups.reverse();
    backups
}

/// Restores a backup file over the live vault file (also backs up the
/// current live file first, so a bad restore is itself reversible).
pub fn restore_backup(
    backup_path: &Path,
    vault_file_path: &Path,
    backup_dir: &Path,
    keep_count: usize,
) -> Result<(), BackupError> {
    if !vault_file::path_exists(backup_path) {
        return Err(BackupError::NotFound);
    }
    create_backup(vault_file_path, backup_dir, keep_count)?;
    vault_file::copy_file(backup_path, vault_file_path)?;
    Ok(())
}

pub fn delete_backup(backup_path: &Path) -> Result<(), BackupError> {
    if !vault_file::path_exists(backup_path) {
        return Err(BackupError::NotFound);
    }
    vault_file::delete_file(backup_path)?;
    Ok(())
}

/// Renames a backup to a user-chosen label. The `vault-` prefix is always
/// enforced and the label is sanitized to characters safe across
/// filesystems (mirrors BackupService.js's sanitization regex exactly).
pub fn rename_backup(backup_path: &Path, new_label: &str, backup_dir: &Path) -> Result<PathBuf, BackupError> {
    if !vault_file::path_exists(backup_path) {
        return Err(BackupError::NotFound);
    }
    let sanitized: String = new_label
        .trim()
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !c.is_control())
        .take(80)
        .collect();
    if sanitized.is_empty() {
        return Err(BackupError::EmptyName);
    }
    let new_path = backup_dir.join(format!("{BACKUP_PREFIX}{sanitized}{BACKUP_SUFFIX}"));
    if new_path != backup_path && vault_file::path_exists(&new_path) {
        return Err(BackupError::NameTaken);
    }
    vault_file::rename_file(backup_path, &new_path)?;
    Ok(new_path)
}

pub fn export_backup_to(backup_path: &Path, dest_path: &Path) -> Result<(), BackupError> {
    if !vault_file::path_exists(backup_path) {
        return Err(BackupError::NotFound);
    }
    vault_file::copy_file(backup_path, dest_path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xela-backup-test-{label}-{}-{}",
            process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_vault_file(path: &Path, contents: &str) {
        vault_file::write_vault_file(
            path,
            vault_file::VaultEnvelopeFields {
                salt: "c2FsdA==".into(),
                iv: "aXY=".into(),
                auth_tag: "dGFn".into(),
                ciphertext: base64_encode(contents),
            },
        )
        .unwrap();
    }

    fn base64_encode(s: &str) -> String {
        use base64::engine::general_purpose::STANDARD as BASE64;
        use base64::Engine as _;
        BASE64.encode(s.as_bytes())
    }

    #[test]
    fn create_backup_returns_none_when_nothing_to_back_up() {
        let dir = temp_dir("none");
        let vault_path = dir.join("vault.xam");
        let backup_dir = dir.join("backups");
        assert_eq!(create_backup(&vault_path, &backup_dir, 10).unwrap(), None);
    }

    #[test]
    fn create_backup_copies_and_lists_newest_first() {
        let dir = temp_dir("list");
        let vault_path = dir.join("vault.xam");
        let backup_dir = dir.join("backups");
        make_vault_file(&vault_path, "v1");

        let b1 = create_backup(&vault_path, &backup_dir, 10).unwrap().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        make_vault_file(&vault_path, "v2");
        let b2 = create_backup(&vault_path, &backup_dir, 10).unwrap().unwrap();

        let listed = list_backups(&backup_dir);
        assert_eq!(listed[0], b2);
        assert_eq!(listed[1], b1);
    }

    #[test]
    fn prune_backups_keeps_only_keep_count_newest() {
        let dir = temp_dir("prune");
        let vault_path = dir.join("vault.xam");
        let backup_dir = dir.join("backups");
        make_vault_file(&vault_path, "v1");

        for _ in 0..5 {
            create_backup(&vault_path, &backup_dir, 2).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(1100));
        }

        assert_eq!(list_backups(&backup_dir).len(), 2);
    }

    #[test]
    fn restore_backup_overwrites_live_file_and_backs_it_up_first() {
        let dir = temp_dir("restore");
        let vault_path = dir.join("vault.xam");
        let backup_dir = dir.join("backups");
        make_vault_file(&vault_path, "original");
        let old_backup = create_backup(&vault_path, &backup_dir, 10).unwrap().unwrap();

        make_vault_file(&vault_path, "modified");
        restore_backup(&old_backup, &vault_path, &backup_dir, 10).unwrap();

        let restored = vault_file::read_vault_file(&vault_path).unwrap();
        assert_eq!(restored.ciphertext, base64_encode("original"));
        // The pre-restore "modified" state should itself have been backed up.
        assert_eq!(list_backups(&backup_dir).len(), 2);
    }

    #[test]
    fn rename_backup_sanitizes_label_and_rejects_collisions() {
        let dir = temp_dir("rename");
        let vault_path = dir.join("vault.xam");
        let backup_dir = dir.join("backups");
        make_vault_file(&vault_path, "v1");
        let backup = create_backup(&vault_path, &backup_dir, 10).unwrap().unwrap();

        let renamed = rename_backup(&backup, "my:label/here", &backup_dir).unwrap();
        assert_eq!(
            renamed.file_name().unwrap().to_str().unwrap(),
            "vault-mylabelhere.xam.bak"
        );

        assert!(matches!(rename_backup(&renamed, "   ", &backup_dir), Err(BackupError::EmptyName)));
    }

    #[test]
    fn delete_and_export_backup_error_on_missing_file() {
        let dir = temp_dir("missing");
        let missing = dir.join("vault-nope.xam.bak");
        assert!(matches!(delete_backup(&missing), Err(BackupError::NotFound)));
        assert!(matches!(
            export_backup_to(&missing, &dir.join("out.xam")),
            Err(BackupError::NotFound)
        ));
    }
}
