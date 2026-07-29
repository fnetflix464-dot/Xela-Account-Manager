// Rust port of src/services/FileService.js. Handles the vault.xam envelope
// (plain JSON outside, encrypted `ciphertext` inside - see crypto.rs for
// that half) and the tmp -> fsync -> rename atomic-write technique that
// gives crash/power-loss safety: a synced temp file renamed over the
// target is never observed half-written, on POSIX or NTFS.

#![allow(dead_code)]

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

pub const VAULT_FILE_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("Vault file not found: {0}")]
    NotFound(String),
    #[error("Vault file is corrupted or not valid JSON")]
    Corrupted,
    #[error("Vault file is missing required fields")]
    MissingFields,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// The vault.xam envelope: everything except `ciphertext` is plaintext
/// metadata needed to attempt decryption; `ciphertext` (+ authTag) is the
/// only part that's actually opaque.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEnvelope {
    #[serde(rename = "fileVersion")]
    pub file_version: u32,
    pub salt: String,
    pub iv: String,
    #[serde(rename = "authTag")]
    pub auth_tag: String,
    pub ciphertext: String,
    #[serde(rename = "savedAt")]
    pub saved_at: String,
}

impl From<&VaultEnvelope> for crate::crypto::EncryptedPayload {
    fn from(env: &VaultEnvelope) -> Self {
        crate::crypto::EncryptedPayload {
            iv: env.iv.clone(),
            auth_tag: env.auth_tag.clone(),
            ciphertext: env.ciphertext.clone(),
        }
    }
}

/// Fields the caller supplies when writing a fresh envelope; fileVersion and
/// savedAt are stamped by `write_vault_file` itself.
pub struct VaultEnvelopeFields {
    pub salt: String,
    pub iv: String,
    pub auth_tag: String,
    pub ciphertext: String,
}

pub fn path_exists(path: &Path) -> bool {
    path.exists()
}

pub fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    if !path_exists(dir) {
        fs::create_dir_all(dir)?;
    }
    Ok(())
}

/// Reads and parses the vault.xam file at `path`.
pub fn read_vault_file(path: &Path) -> Result<VaultEnvelope, FileError> {
    if !path_exists(path) {
        return Err(FileError::NotFound(path.display().to_string()));
    }
    let raw = fs::read_to_string(path)?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|_| FileError::Corrupted)?;

    for field in ["salt", "iv", "authTag", "ciphertext"] {
        match value.get(field) {
            Some(v) if v.is_string() && !v.as_str().unwrap().is_empty() => {}
            _ => return Err(FileError::MissingFields),
        }
    }

    serde_json::from_value(value).map_err(|_| FileError::MissingFields)
}

/// Well-formed check (valid JSON, expected fields) without needing a
/// password - deliberately a different question from "is the password
/// correct" (see FileService.js's isVaultFileStructurallyValid for why).
pub fn is_vault_file_structurally_valid(path: &Path) -> bool {
    read_vault_file(path).is_ok()
}

fn temp_path_for(path: &Path) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut s = path.as_os_str().to_os_string();
    s.push(format!(".{}.{}.tmp", process::id(), now));
    PathBuf::from(s)
}

fn write_atomic_bytes(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        ensure_dir(dir)?;
    }
    let temp_path = temp_path_for(path);

    let write_result = (|| -> std::io::Result<()> {
        let mut opts = OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file: File = opts.open(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    })();

    if let Err(err) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(err);
    }

    fs::rename(&temp_path, path)
}

/// Writes the vault envelope atomically: tmp -> write -> fsync -> rename.
pub fn write_vault_file(path: &Path, fields: VaultEnvelopeFields) -> Result<(), FileError> {
    let saved_at = chrono_like_now_iso8601();
    let envelope = VaultEnvelope {
        file_version: VAULT_FILE_VERSION,
        salt: fields.salt,
        iv: fields.iv,
        auth_tag: fields.auth_tag,
        ciphertext: fields.ciphertext,
        saved_at,
    };
    let json = serde_json::to_string(&envelope).map_err(|_| FileError::Corrupted)?;
    write_atomic_bytes(path, json.as_bytes())?;
    Ok(())
}

/// Generic atomic write for small non-vault JSON files (the quick-unlock
/// envelope). Same tmp -> fsync -> rename technique as write_vault_file.
pub fn write_json_file_atomic<T: Serialize>(path: &Path, data: &T) -> Result<(), FileError> {
    let json = serde_json::to_string(data).map_err(|_| FileError::Corrupted)?;
    write_atomic_bytes(path, json.as_bytes())?;
    Ok(())
}

/// Reads a JSON file written by write_json_file_atomic. Returns None (never
/// errors) if the file doesn't exist or isn't valid JSON/shape.
pub fn read_json_file<T: DeserializeOwned>(path: &Path) -> Option<T> {
    if !path_exists(path) {
        return None;
    }
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn copy_file(source: &Path, dest: &Path) -> std::io::Result<()> {
    if let Some(dir) = dest.parent() {
        ensure_dir(dir)?;
    }
    fs::copy(source, dest)?;
    Ok(())
}

/// Lists files in a directory matching a prefix, sorted oldest-to-newest by
/// mtime. Missing directory yields an empty vec.
pub fn list_files_by_prefix(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    if !path_exists(dir) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(PathBuf, std::time::SystemTime)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name();
            let name = name.to_str()?;
            if !name.starts_with(prefix) {
                return None;
            }
            let mtime = e.metadata().ok()?.modified().ok()?;
            Some((e.path(), mtime))
        })
        .collect();
    files.sort_by_key(|(_, mtime)| *mtime);
    files.into_iter().map(|(p, _)| p).collect()
}

pub fn delete_file(path: &Path) -> std::io::Result<()> {
    if path_exists(path) {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub fn rename_file(old_path: &Path, new_path: &Path) -> std::io::Result<()> {
    fs::rename(old_path, new_path)
}

/// Minimal RFC3339 "now" without pulling in the `chrono` crate just for a
/// timestamp string - matches the precision of JS's Date#toISOString().
fn chrono_like_now_iso8601() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let millis = now.as_millis();
    let secs = (millis / 1000) as i64;
    let ms = (millis % 1000) as u32;
    format_unix_secs(secs, ms)
}

/// Crate-visible so backup.rs can derive a filename-safe timestamp from the
/// same clock/format basis as the vault envelope's savedAt.
pub(crate) fn iso8601_for(secs: i64, millis: u32) -> String {
    format_unix_secs(secs, millis)
}

/// Civil-date conversion from a Unix timestamp (UTC), avoiding an extra
/// dependency for one timestamp field. Algorithm: Howard Hinnant's
/// days_from_civil, well-known and independently verifiable.
fn format_unix_secs(secs: i64, millis: u32) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m, d, hour, min, sec, millis
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xela-fileservice-test-{}-{}",
            process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_fields() -> VaultEnvelopeFields {
        VaultEnvelopeFields {
            salt: "c2FsdA==".into(),
            iv: "aXY=".into(),
            auth_tag: "dGFn".into(),
            ciphertext: "Y2lwaGVydGV4dA==".into(),
        }
    }

    #[test]
    fn writes_a_file_readable_back() {
        let dir = temp_dir();
        let path = dir.join("vault.xam");
        write_vault_file(&path, sample_fields()).unwrap();

        let read = read_vault_file(&path).unwrap();
        assert_eq!(read.salt, "c2FsdA==");
        assert_eq!(read.ciphertext, "Y2lwaGVydGV4dA==");
        assert_eq!(read.file_version, VAULT_FILE_VERSION);
    }

    #[test]
    fn leaves_no_tmp_file_behind() {
        let dir = temp_dir();
        let path = dir.join("vault.xam");
        write_vault_file(&path, sample_fields()).unwrap();

        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn creates_file_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        let path = dir.join("vault.xam");
        write_vault_file(&path, sample_fields()).unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn missing_file_is_not_structurally_valid_and_errors_as_not_found() {
        let dir = temp_dir();
        let path = dir.join("does-not-exist.xam");
        assert!(!is_vault_file_structurally_valid(&path));
        assert!(matches!(read_vault_file(&path), Err(FileError::NotFound(_))));
    }

    #[test]
    fn corrupted_json_is_rejected() {
        let dir = temp_dir();
        let path = dir.join("vault.xam");
        fs::write(&path, b"not json").unwrap();
        assert!(matches!(read_vault_file(&path), Err(FileError::Corrupted)));
    }

    #[test]
    fn missing_required_fields_is_rejected() {
        let dir = temp_dir();
        let path = dir.join("vault.xam");
        fs::write(&path, br#"{"salt":"x"}"#).unwrap();
        assert!(matches!(read_vault_file(&path), Err(FileError::MissingFields)));
    }

    #[test]
    fn list_files_by_prefix_sorts_oldest_first_and_filters() {
        let dir = temp_dir();
        fs::write(dir.join("vault-a.bak"), b"1").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        fs::write(dir.join("vault-b.bak"), b"2").unwrap();
        fs::write(dir.join("other.bak"), b"3").unwrap();

        let files = list_files_by_prefix(&dir, "vault-");
        let names: Vec<_> = files
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["vault-a.bak", "vault-b.bak"]);
    }
}

#[cfg(test)]
mod timestamp_tests {
    use super::format_unix_secs;

    #[test]
    fn matches_known_iso8601_instants() {
        // 2026-07-29T22:16:11.312Z from the actual fixture-generation run.
        assert_eq!(format_unix_secs(1785363371, 312), "2026-07-29T22:16:11.312Z");
        // Unix epoch.
        assert_eq!(format_unix_secs(0, 0), "1970-01-01T00:00:00.000Z");
        // A leap-day boundary.
        assert_eq!(format_unix_secs(1582934400, 0), "2020-02-29T00:00:00.000Z");
    }
}
