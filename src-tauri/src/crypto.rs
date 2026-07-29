// Rust port of src/services/CryptoService.js. Parameters (algorithm, key/IV/
// salt/tag lengths, PBKDF2 iteration count) are kept byte-for-byte identical
// to the Node implementation so existing vault.xam files stay decryptable
// after the Electron -> Tauri migration. See crypto::tests::vector_matches_node_output
// for a known-answer vector generated directly from the Node CryptoService.
//
// Nothing calls into this module yet - it's wired into Tauri commands once
// VaultService/FileService land, so `dead_code` is expected until then.
#![allow(dead_code)]

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

pub const KEY_LENGTH: usize = 32; // 256 bits
pub const IV_LENGTH: usize = 12; // 96 bits, NIST-recommended for GCM
pub const AUTH_TAG_LENGTH: usize = 16; // 128 bits
pub const SALT_LENGTH: usize = 32; // 256 bits
pub const PBKDF2_ITERATIONS: u32 = 210_000; // OWASP 2023+ recommendation

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Password must be a non-empty string")]
    EmptyPassword,
    #[error("Encryption key must be a 32-byte buffer")]
    InvalidKeyLength,
    #[error("Malformed encrypted payload")]
    MalformedPayload,
    #[error("Decryption failed: incorrect master password or corrupted vault")]
    DecryptionFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EncryptedPayload {
    pub iv: String,
    #[serde(rename = "authTag")]
    pub auth_tag: String,
    pub ciphertext: String,
}

/// Generates a cryptographically random salt for key derivation.
pub fn generate_salt() -> Vec<u8> {
    let mut salt = vec![0u8; SALT_LENGTH];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

/// Derives a 256-bit AES key from a master password and salt using PBKDF2-HMAC-SHA256.
pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; KEY_LENGTH], CryptoError> {
    if password.is_empty() {
        return Err(CryptoError::EmptyPassword);
    }
    let mut key = [0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    Ok(key)
}

fn cipher_for(key: &[u8]) -> Result<Aes256Gcm, CryptoError> {
    if key.len() != KEY_LENGTH {
        return Err(CryptoError::InvalidKeyLength);
    }
    Ok(Aes256Gcm::new_from_slice(key).expect("key length already validated"))
}

/// Encrypts with an explicit IV. Only exposed within the crate so tests can
/// pin the IV to reproduce known-answer vectors; production code must always
/// go through `encrypt`, which mints a fresh random IV per call.
fn encrypt_with_iv(plaintext: &str, key: &[u8], iv: &[u8; IV_LENGTH]) -> Result<EncryptedPayload, CryptoError> {
    let cipher = cipher_for(key)?;
    let nonce = Nonce::from_slice(iv);
    let combined = cipher
        .encrypt(nonce, Payload { msg: plaintext.as_bytes(), aad: &[] })
        .map_err(|_| CryptoError::DecryptionFailed)?;
    let tag_start = combined.len() - AUTH_TAG_LENGTH;
    let (ciphertext, tag) = combined.split_at(tag_start);
    Ok(EncryptedPayload {
        iv: BASE64.encode(iv),
        auth_tag: BASE64.encode(tag),
        ciphertext: BASE64.encode(ciphertext),
    })
}

/// Encrypts a plaintext string with AES-256-GCM using the given key. A fresh
/// random IV is generated for every call (required - IVs must never be
/// reused with the same key under GCM).
pub fn encrypt(plaintext: &str, key: &[u8]) -> Result<EncryptedPayload, CryptoError> {
    let mut iv = [0u8; IV_LENGTH];
    rand::thread_rng().fill_bytes(&mut iv);
    encrypt_with_iv(plaintext, key, &iv)
}

/// Decrypts a payload produced by `encrypt`. Fails if the key is wrong or the
/// data has been tampered with (GCM authentication failure).
pub fn decrypt(payload: &EncryptedPayload, key: &[u8]) -> Result<String, CryptoError> {
    let cipher = cipher_for(key)?;

    let iv = BASE64.decode(&payload.iv).map_err(|_| CryptoError::MalformedPayload)?;
    let tag = BASE64
        .decode(&payload.auth_tag)
        .map_err(|_| CryptoError::MalformedPayload)?;
    let ciphertext = BASE64
        .decode(&payload.ciphertext)
        .map_err(|_| CryptoError::MalformedPayload)?;
    if iv.len() != IV_LENGTH {
        return Err(CryptoError::MalformedPayload);
    }

    let nonce = Nonce::from_slice(&iv);
    let mut combined = ciphertext;
    combined.extend_from_slice(&tag);

    let plaintext = cipher
        .decrypt(nonce, combined.as_ref())
        .map_err(|_| CryptoError::DecryptionFailed)?;
    String::from_utf8(plaintext).map_err(|_| CryptoError::DecryptionFailed)
}

/// Encrypts a serializable value as JSON.
pub fn encrypt_object<T: Serialize>(value: &T, key: &[u8]) -> Result<EncryptedPayload, CryptoError> {
    let json = serde_json::to_string(value).map_err(|_| CryptoError::MalformedPayload)?;
    encrypt(&json, key)
}

/// Decrypts a payload and parses it as JSON.
pub fn decrypt_object<T: for<'de> Deserialize<'de>>(
    payload: &EncryptedPayload,
    key: &[u8],
) -> Result<T, CryptoError> {
    let json = decrypt(payload, key)?;
    serde_json::from_str(&json).map_err(|_| CryptoError::MalformedPayload)
}

/// Verifies a password against a stored salt + a known-good encrypted probe
/// payload without erroring out - returns a bool like the JS original.
pub fn verify_password(password: &str, salt: &[u8], probe: &EncryptedPayload) -> bool {
    match derive_key(password, salt) {
        Ok(key) => decrypt(probe, &key).is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_salt_has_correct_length_and_is_random() {
        let a = generate_salt();
        let b = generate_salt();
        assert_eq!(a.len(), SALT_LENGTH);
        assert_ne!(a, b);
    }

    #[test]
    fn derive_key_is_deterministic_for_same_password_and_salt() {
        let salt = generate_salt();
        let k1 = derive_key("correct horse battery staple", &salt).unwrap();
        let k2 = derive_key("correct horse battery staple", &salt).unwrap();
        assert_eq!(k1, k2);
    }

    #[test]
    fn derive_key_differs_for_different_password_or_salt() {
        let salt = generate_salt();
        let k1 = derive_key("correct horse battery staple", &salt).unwrap();
        let k2 = derive_key("Correct Horse Battery Staple", &salt).unwrap();
        assert_ne!(k1, k2);

        let k3 = derive_key("same password", &generate_salt()).unwrap();
        let k4 = derive_key("same password", &generate_salt()).unwrap();
        assert_ne!(k3, k4);
    }

    #[test]
    fn derive_key_rejects_empty_password() {
        assert!(derive_key("", &generate_salt()).is_err());
    }

    #[test]
    fn round_trips_plaintext_including_empty_and_unicode() {
        let key = derive_key("test-password", &generate_salt()).unwrap();
        for text in ["hello world", "", "\u{1F510} p\u{e4}ssw\u{f6}rd \u{30c7}\u{30fc}\u{30bf}"] {
            let payload = encrypt(text, &key).unwrap();
            assert_eq!(decrypt(&payload, &key).unwrap(), text);
        }
    }

    #[test]
    fn never_reuses_iv_or_ciphertext_across_calls() {
        let key = derive_key("test-password", &generate_salt()).unwrap();
        let a = encrypt("same plaintext", &key).unwrap();
        let b = encrypt("same plaintext", &key).unwrap();
        assert_ne!(a.iv, b.iv);
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    #[test]
    fn rejects_key_of_wrong_length() {
        assert!(matches!(encrypt("text", b"too-short"), Err(CryptoError::InvalidKeyLength)));
    }

    #[test]
    fn fails_to_decrypt_with_wrong_key() {
        let key = derive_key("test-password", &generate_salt()).unwrap();
        let payload = encrypt("secret", &key).unwrap();
        let wrong_key = derive_key("wrong-password", &generate_salt()).unwrap();
        assert!(matches!(decrypt(&payload, &wrong_key), Err(CryptoError::DecryptionFailed)));
    }

    #[test]
    fn detects_tampered_ciphertext_and_auth_tag() {
        let key = derive_key("test-password", &generate_salt()).unwrap();
        let payload = encrypt("secret", &key).unwrap();

        let mut tampered_ct = payload.clone();
        tampered_ct.ciphertext = BASE64.encode(b"tampered-bytes-here");
        assert!(decrypt(&tampered_ct, &key).is_err());

        let mut tag_bytes = BASE64.decode(&payload.auth_tag).unwrap();
        tag_bytes[0] ^= 0xff;
        let mut tampered_tag = payload.clone();
        tampered_tag.auth_tag = BASE64.encode(&tag_bytes);
        assert!(decrypt(&tampered_tag, &key).is_err());
    }

    #[test]
    fn rejects_malformed_payload_missing_fields() {
        let err = serde_json::from_str::<EncryptedPayload>(r#"{"iv":"x"}"#);
        assert!(err.is_err());
    }

    #[test]
    fn encrypt_object_round_trips_nested_structures() {
        let key = derive_key("password", &generate_salt()).unwrap();
        let value = serde_json::json!({ "a": 1, "nested": { "b": [1, 2, 3], "c": "text" } });
        let payload = encrypt_object(&value, &key).unwrap();
        let recovered: serde_json::Value = decrypt_object(&payload, &key).unwrap();
        assert_eq!(recovered, value);
    }

    #[test]
    fn verify_password_true_for_correct_false_for_incorrect() {
        let salt = generate_salt();
        let key = derive_key("right-password", &salt).unwrap();
        let probe = encrypt("probe-plaintext", &key).unwrap();
        assert!(verify_password("right-password", &salt, &probe));
        assert!(!verify_password("wrong-password", &salt, &probe));
    }

    /// Known-answer test generated directly from the Node CryptoService
    /// (see the migration commit message / PR description for the exact
    /// script). Confirms the Rust port is byte-for-byte interoperable with
    /// vault.xam files written by the Electron app - not just internally
    /// self-consistent.
    #[test]
    fn vector_matches_node_output() {
        let salt = hex_decode("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
        let password = "correct horse battery staple";
        let expected_key_hex = "e2c77bfd1b2b14f794c8e34928e500d2765adcbcc31e6a5191b34a1c8247304f";
        let iv = hex_decode("202122232425262728292a2b");
        let plaintext = "hello tauri migration \u{1F510} data";
        let expected_iv_b64 = "ICEiIyQlJicoKSor";
        let expected_auth_tag_b64 = "w04XAS5N5j+smUrNRTSymA==";
        let expected_ciphertext_b64 = "SJp1MuukQlpcb3vqd3gXeMYQjncYjp+GJwPQ1gb2wA==";

        let key = derive_key(password, &salt).unwrap();
        assert_eq!(hex_encode(&key), expected_key_hex);

        let mut iv_arr = [0u8; IV_LENGTH];
        iv_arr.copy_from_slice(&iv);
        let payload = encrypt_with_iv(plaintext, &key, &iv_arr).unwrap();

        assert_eq!(payload.iv, expected_iv_b64);
        assert_eq!(payload.auth_tag, expected_auth_tag_b64);
        assert_eq!(payload.ciphertext, expected_ciphertext_b64);

        assert_eq!(decrypt(&payload, &key).unwrap(), plaintext);
    }

    fn hex_decode(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    fn hex_encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}
