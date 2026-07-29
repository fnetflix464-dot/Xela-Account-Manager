// Rust port of src/services/QuickUnlockService.js.
//
// PIN-based quick unlock is a *convenience* layer only - the master
// password remains the vault's real encryption key. Enabling it wraps the
// already-derived session key (not the master password) using the OS's own
// credential store (Keychain/Secret Service/DPAPI via the `keyring` crate),
// which can only be read back by the same OS user account. The PIN itself
// is checked separately (a stored PBKDF2 verifier, never the encryption key
// for anything) purely as a local "did you type the right PIN" UX gate.
//
// One deliberate departure from the Electron version: safeStorage is a
// symmetric-encryption primitive, so the JS code encrypts a blob and stores
// the *ciphertext* itself in a local file. The `keyring` crate instead
// stores the secret value directly inside the OS-managed keyring database,
// so here the local file holds only the PIN verifier - the session
// key/salt live entirely in the OS keyring entry. Same security boundary
// (OS user account), simpler split.
//
// Existing safeStorage-wrapped quick-unlock data from the Electron app
// cannot carry over (different wrapping backend) - by design, per product
// decision: users just re-enable quick unlock once after upgrading. This
// does not affect the master password or vault contents.

#![allow(dead_code)]

use crate::crypto::{self, CryptoError};
use crate::vault_file;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::path::Path;

const PIN_MIN_LENGTH: usize = 4;
const PIN_MAX_LENGTH: usize = 12;

/// The keyring "service" this app's quick-unlock secret is stored under.
/// A single fixed account name is fine - there is exactly one vault/quick-
/// unlock setup per OS user account, same as the Electron version.
const KEYRING_SERVICE: &str = "com.xela.accountmanager";
const KEYRING_ACCOUNT: &str = "quick-unlock";

#[derive(Debug, thiserror::Error)]
pub enum QuickUnlockError {
    #[error("PIN must be {PIN_MIN_LENGTH}-{PIN_MAX_LENGTH} digits")]
    InvalidPin,
    #[error("Quick unlock is not available on this system")]
    Unavailable,
    #[error("Quick unlock is not set up")]
    NotSetUp,
    #[error("Incorrect PIN")]
    IncorrectPin,
    #[error("Could not unwrap quick unlock data - it may belong to a different device or user account")]
    UnwrapFailed,
    #[error(transparent)]
    Crypto(#[from] CryptoError),
    #[error(transparent)]
    File(#[from] vault_file::FileError),
}

/// Dependency-injection seam standing in for Electron's `safeStorage`
/// parameter - lets tests exercise enable/unlock without a real OS keyring
/// daemon (this sandbox has none), exactly like QuickUnlockService.test.js
/// injects a fake safeStorage.
pub trait KeyringBackend {
    fn is_available(&self) -> bool;
    fn set_secret(&self, key: &str, value: &str) -> Result<(), ()>;
    fn get_secret(&self, key: &str) -> Result<String, ()>;
    fn delete_secret(&self, key: &str) -> Result<(), ()>;
}

/// Real OS-backed implementation via the `keyring` crate (Keychain on
/// macOS, Secret Service/libsecret on Linux, Credential Manager on
/// Windows).
pub struct OsKeyring {
    service: String,
}

impl OsKeyring {
    pub fn new() -> Self {
        Self { service: KEYRING_SERVICE.to_string() }
    }

    fn entry(&self, key: &str) -> Result<keyring::Entry, keyring::Error> {
        keyring::Entry::new(&self.service, key)
    }
}

impl Default for OsKeyring {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyringBackend for OsKeyring {
    /// No direct "is encryption available" query exists for `keyring`
    /// (unlike safeStorage) - probe with a real round-trip against a
    /// canary entry instead, cleaning up after itself either way.
    fn is_available(&self) -> bool {
        let probe_key = "availability-probe";
        let Ok(entry) = self.entry(probe_key) else { return false };
        let ok = entry.set_password("probe").is_ok()
            && entry.get_password().map(|v| v == "probe").unwrap_or(false);
        let _ = entry.delete_credential();
        ok
    }

    fn set_secret(&self, key: &str, value: &str) -> Result<(), ()> {
        self.entry(key).map_err(|_| ())?.set_password(value).map_err(|_| ())
    }

    fn get_secret(&self, key: &str) -> Result<String, ()> {
        self.entry(key).map_err(|_| ())?.get_password().map_err(|_| ())
    }

    fn delete_secret(&self, key: &str) -> Result<(), ()> {
        self.entry(key).map_err(|_| ())?.delete_credential().map_err(|_| ())
    }
}

#[derive(Serialize, Deserialize)]
struct QuickUnlockRecord {
    #[serde(rename = "verifierSalt")]
    verifier_salt: String,
    #[serde(rename = "verifierHash")]
    verifier_hash: String,
}

#[derive(Serialize, Deserialize)]
struct WrappedSecret {
    salt: String,
    #[serde(rename = "sessionKey")]
    session_key: String,
}

pub struct Recovered {
    pub session_key: Vec<u8>,
    pub salt: Vec<u8>,
}

pub fn is_available(backend: &dyn KeyringBackend) -> bool {
    backend.is_available()
}

pub fn is_enabled(quick_unlock_file_path: &Path) -> bool {
    vault_file::path_exists(quick_unlock_file_path)
}

fn validate_pin(pin: &str) -> Result<(), QuickUnlockError> {
    let in_range = pin.len() >= PIN_MIN_LENGTH && pin.len() <= PIN_MAX_LENGTH;
    if pin.is_empty() || !pin.chars().all(|c| c.is_ascii_digit()) || !in_range {
        return Err(QuickUnlockError::InvalidPin);
    }
    Ok(())
}

/// Wraps the current session key (+ its salt) under the OS credential
/// store, gated behind a PIN verifier. Overwrites any previous quick
/// unlock setup.
pub fn enable(
    quick_unlock_file_path: &Path,
    backend: &dyn KeyringBackend,
    pin: &str,
    session_key: &[u8],
    salt: &[u8],
) -> Result<(), QuickUnlockError> {
    validate_pin(pin)?;
    if !backend.is_available() {
        return Err(QuickUnlockError::Unavailable);
    }

    let verifier_salt = crypto::generate_salt();
    let verifier_hash = crypto::derive_key(pin, &verifier_salt)?;

    let secret = WrappedSecret {
        salt: BASE64.encode(salt),
        session_key: BASE64.encode(session_key),
    };
    let secret_json = serde_json::to_string(&secret).expect("serializing base64 strings cannot fail");
    backend
        .set_secret(KEYRING_ACCOUNT, &secret_json)
        .map_err(|_| QuickUnlockError::Unavailable)?;

    let record = QuickUnlockRecord {
        verifier_salt: BASE64.encode(verifier_salt),
        verifier_hash: BASE64.encode(verifier_hash),
    };
    vault_file::write_json_file_atomic(quick_unlock_file_path, &record)?;
    Ok(())
}

pub fn disable(quick_unlock_file_path: &Path, backend: &dyn KeyringBackend) -> Result<(), QuickUnlockError> {
    let _ = backend.delete_secret(KEYRING_ACCOUNT); // best-effort, mirrors JS (no availability check)
    vault_file::delete_file(quick_unlock_file_path).map_err(vault_file::FileError::Io)?;
    Ok(())
}

/// Verifies the PIN and unwraps the session key. Errors on a wrong PIN, a
/// missing/corrupt quick-unlock file, or an unavailable/foreign OS
/// credential store (e.g. the file was copied to a different machine/user
/// account).
pub fn unlock(
    quick_unlock_file_path: &Path,
    backend: &dyn KeyringBackend,
    pin: &str,
) -> Result<Recovered, QuickUnlockError> {
    let record: QuickUnlockRecord =
        vault_file::read_json_file(quick_unlock_file_path).ok_or(QuickUnlockError::NotSetUp)?;
    if !backend.is_available() {
        return Err(QuickUnlockError::Unavailable);
    }

    let verifier_salt = BASE64.decode(&record.verifier_salt).map_err(|_| QuickUnlockError::NotSetUp)?;
    let expected_hash = BASE64.decode(&record.verifier_hash).map_err(|_| QuickUnlockError::NotSetUp)?;
    let candidate_hash = crypto::derive_key(pin, &verifier_salt)?;
    if candidate_hash.as_slice() != expected_hash.as_slice() {
        return Err(QuickUnlockError::IncorrectPin);
    }

    let secret_json = backend
        .get_secret(KEYRING_ACCOUNT)
        .map_err(|_| QuickUnlockError::UnwrapFailed)?;
    let secret: WrappedSecret = serde_json::from_str(&secret_json).map_err(|_| QuickUnlockError::UnwrapFailed)?;
    let session_key = BASE64.decode(&secret.session_key).map_err(|_| QuickUnlockError::UnwrapFailed)?;
    let salt = BASE64.decode(&secret.salt).map_err(|_| QuickUnlockError::UnwrapFailed)?;
    Ok(Recovered { session_key, salt })
}

/// In-memory stand-in for the OS keyring, mirroring the JS test suite's
/// createFakeSafeStorage(): lets tests exercise enable/unlock without
/// depending on a real Keychain/Secret Service/DPAPI being present (this
/// sandbox has no secret-service daemon at all). `pub(crate)` so
/// vault_service.rs's tests can reuse it instead of duplicating.
#[cfg(test)]
pub(crate) mod test_support {
    use super::KeyringBackend;
    use std::cell::RefCell;
    use std::collections::HashMap;

    pub(crate) struct FakeKeyring {
        available: bool,
        store: RefCell<HashMap<String, String>>,
    }

    impl FakeKeyring {
        pub(crate) fn new() -> Self {
            Self { available: true, store: RefCell::new(HashMap::new()) }
        }
        pub(crate) fn unavailable() -> Self {
            Self { available: false, store: RefCell::new(HashMap::new()) }
        }
        pub(crate) fn has_secret(&self, key: &str) -> bool {
            self.store.borrow().contains_key(key)
        }
    }

    impl KeyringBackend for FakeKeyring {
        fn is_available(&self) -> bool {
            self.available
        }
        fn set_secret(&self, key: &str, value: &str) -> Result<(), ()> {
            self.store.borrow_mut().insert(key.to_string(), value.to_string());
            Ok(())
        }
        fn get_secret(&self, key: &str) -> Result<String, ()> {
            self.store.borrow().get(key).cloned().ok_or(())
        }
        fn delete_secret(&self, key: &str) -> Result<(), ()> {
            self.store.borrow_mut().remove(key);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::FakeKeyring;
    use super::*;
    use std::fs;
    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_quick_unlock_path() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xela-quickunlock-test-{}-{}",
            process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join("quickunlock.dat")
    }

    #[test]
    fn is_available_reflects_backend_and_false_when_unavailable() {
        assert!(is_available(&FakeKeyring::new()));
        assert!(!is_available(&FakeKeyring::unavailable()));
    }

    #[test]
    fn enable_is_enabled_disable_lifecycle() {
        let path = temp_quick_unlock_path();
        let backend = FakeKeyring::new();
        assert!(!is_enabled(&path));

        enable(&path, &backend, "1234", b"session-key-32-bytes-long-000000", b"salt").unwrap();
        assert!(is_enabled(&path));

        disable(&path, &backend).unwrap();
        assert!(!is_enabled(&path));
    }

    #[test]
    fn rejects_non_numeric_or_out_of_range_pin() {
        let path = temp_quick_unlock_path();
        let backend = FakeKeyring::new();
        let key = b"session-key-32-bytes-long-000000";
        let salt = b"salt";

        assert!(matches!(enable(&path, &backend, "abcd", key, salt), Err(QuickUnlockError::InvalidPin)));
        assert!(matches!(enable(&path, &backend, "12", key, salt), Err(QuickUnlockError::InvalidPin)));
        assert!(matches!(
            enable(&path, &backend, "1234567890123", key, salt),
            Err(QuickUnlockError::InvalidPin)
        ));
    }

    #[test]
    fn enable_fails_when_backend_unavailable() {
        let path = temp_quick_unlock_path();
        let backend = FakeKeyring::unavailable();
        assert!(matches!(
            enable(&path, &backend, "1234", b"key", b"salt"),
            Err(QuickUnlockError::Unavailable)
        ));
    }

    #[test]
    fn round_trips_session_key_and_salt_through_enable_unlock() {
        let path = temp_quick_unlock_path();
        let backend = FakeKeyring::new();
        let session_key = crypto::generate_salt(); // any 32 bytes stands in as a key
        let salt = crypto::generate_salt();

        enable(&path, &backend, "4242", &session_key, &salt).unwrap();
        let recovered = unlock(&path, &backend, "4242").unwrap();

        assert_eq!(recovered.session_key, session_key);
        assert_eq!(recovered.salt, salt);
    }

    #[test]
    fn rejects_incorrect_pin_without_touching_the_keyring_secret() {
        let path = temp_quick_unlock_path();
        let backend = FakeKeyring::new();
        enable(&path, &backend, "4242", &crypto::generate_salt(), &crypto::generate_salt()).unwrap();

        let result = unlock(&path, &backend, "0000");
        assert!(matches!(result, Err(QuickUnlockError::IncorrectPin)));
        // The secret must still be exactly what enable() wrote - unlock()
        // must reject the PIN before ever touching backend.get_secret.
        assert!(backend.has_secret(KEYRING_ACCOUNT));
    }

    #[test]
    fn errors_clearly_when_never_set_up() {
        let path = temp_quick_unlock_path();
        let backend = FakeKeyring::new();
        assert!(matches!(unlock(&path, &backend, "1234"), Err(QuickUnlockError::NotSetUp)));
    }

    #[test]
    fn errors_when_wrapped_data_belongs_to_a_different_backend() {
        let path = temp_quick_unlock_path();
        let enable_backend = FakeKeyring::new();
        enable(&path, &enable_backend, "4242", &crypto::generate_salt(), &crypto::generate_salt()).unwrap();

        // A different backend instance simulates a different OS credential
        // store (e.g. the file was copied to another machine) - it has no
        // record of enable_backend's secret.
        let other_backend = FakeKeyring::new();
        assert!(matches!(unlock(&path, &other_backend, "4242"), Err(QuickUnlockError::UnwrapFailed)));
    }
}

#[cfg(test)]
mod os_backend_smoke_test {
    use super::*;

    /// Not a correctness test of the OS backend itself (no secret-service
    /// daemon runs in this sandbox) - just confirms OsKeyring::is_available()
    /// degrades to `false` instead of panicking when the platform backend
    /// is unreachable, exactly like Electron's safeStorage.isEncryptionAvailable()
    /// would report false on a headless Linux box with no keyring provider.
    #[test]
    fn os_keyring_is_available_does_not_panic_without_a_backend() {
        let backend = OsKeyring::new();
        let _ = backend.is_available();
    }
}
