// Rust port of src/services/SettingsService.js.

use crate::model::settings::{update_settings as apply_update, THEMES};
use crate::model::{Settings, SettingsUpdate};

const MIN_PASSWORD_LENGTH: i64 = 6;
const MAX_PASSWORD_LENGTH: i64 = 128;
const MIN_BACKUP_COUNT: i64 = 1;
const MAX_BACKUP_COUNT: i64 = 100;
// Generous but bounded - the renderer resizes/compresses images before
// setting this, so a legitimate value is normally well under 1MB; this cap
// just stops the settings blob from growing unbounded if that resize step
// is ever bypassed.
const MAX_BACKGROUND_IMAGE_LENGTH: usize = 4 * 1024 * 1024;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SettingsError {
    #[error("Invalid theme: {0}")]
    InvalidTheme(String),
    #[error("Auto-lock minutes must be zero (disabled) or greater")]
    InvalidAutoLockMinutes,
    #[error("Backup count must be an integer between {MIN_BACKUP_COUNT} and {MAX_BACKUP_COUNT}")]
    InvalidBackupCount,
    #[error("Recent file limit must be at least 1")]
    InvalidRecentFileLimit,
    #[error("Password generator length must be an integer between {MIN_PASSWORD_LENGTH} and {MAX_PASSWORD_LENGTH}")]
    InvalidPasswordGeneratorLength,
    #[error("At least one password generator character set must be enabled")]
    NoPasswordGeneratorCharsetEnabled,
    #[error("Clipboard auto-clear seconds must be zero (disabled) or greater")]
    InvalidClipboardClearSeconds,
    #[error("Password history limit must be zero (disabled) or greater")]
    InvalidPasswordHistoryLimit,
    #[error("{0} must be a 6-digit hex color (e.g. {1}) or null")]
    InvalidHexColor(String, String),
    #[error("Background image must be an image data URI or null")]
    InvalidBackgroundImage,
    #[error("Background image is too large")]
    BackgroundImageTooLarge,
}

fn validate_hex_color(value: &Option<String>, label: &str, example: &str) -> Result<(), SettingsError> {
    let Some(v) = value else { return Ok(()) };
    let valid = v.len() == 7 && v.starts_with('#') && v[1..].chars().all(|c| c.is_ascii_hexdigit());
    if !valid {
        return Err(SettingsError::InvalidHexColor(label.to_string(), example.to_string()));
    }
    Ok(())
}

/// Validates a fully-resolved Settings object, erroring on the first
/// violation found (mirrors the bounds enforced by the Settings UI's own
/// input min/max attributes, plus the password generator's "at least one
/// character set" rule - enforced here too so bad settings are rejected at
/// save time, not just at generation time).
pub fn validate(settings: &Settings) -> Result<(), SettingsError> {
    if !THEMES.contains(&settings.theme.as_str()) {
        return Err(SettingsError::InvalidTheme(settings.theme.clone()));
    }
    if settings.auto_lock_minutes.is_nan() || settings.auto_lock_minutes < 0.0 {
        return Err(SettingsError::InvalidAutoLockMinutes);
    }
    if settings.backup_count < MIN_BACKUP_COUNT || settings.backup_count > MAX_BACKUP_COUNT {
        return Err(SettingsError::InvalidBackupCount);
    }
    if settings.recent_file_limit < 1 {
        return Err(SettingsError::InvalidRecentFileLimit);
    }

    let pg = &settings.password_generator;
    if pg.length < MIN_PASSWORD_LENGTH || pg.length > MAX_PASSWORD_LENGTH {
        return Err(SettingsError::InvalidPasswordGeneratorLength);
    }
    if !pg.uppercase && !pg.lowercase && !pg.numbers && !pg.symbols {
        return Err(SettingsError::NoPasswordGeneratorCharsetEnabled);
    }

    if settings.clipboard_clear_seconds < 0.0 {
        return Err(SettingsError::InvalidClipboardClearSeconds);
    }
    if settings.password_history_limit < 0 {
        return Err(SettingsError::InvalidPasswordHistoryLimit);
    }
    validate_hex_color(&settings.accent_color, "Accent color", "#667eea")?;
    validate_hex_color(&settings.background_color, "Background color", "#f9fafb")?;
    validate_hex_color(&settings.panel_color, "Panel color", "#ffffff")?;
    if let Some(image) = &settings.background_image {
        if !image.starts_with("data:image/") {
            return Err(SettingsError::InvalidBackgroundImage);
        }
        if image.len() > MAX_BACKGROUND_IMAGE_LENGTH {
            return Err(SettingsError::BackgroundImageTooLarge);
        }
    }
    Ok(())
}

pub fn create_default() -> Settings {
    Settings::default()
}

/// Merges `updates` into `current` and validates the result before
/// returning it. Errors (without mutating anything) if the merged result
/// would be invalid.
pub fn update(current: &Settings, updates: SettingsUpdate) -> Result<Settings, SettingsError> {
    let next = apply_update(current, updates);
    validate(&next)?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::settings::create_settings;

    #[test]
    fn default_settings_are_valid() {
        assert!(validate(&create_settings()).is_ok());
    }

    #[test]
    fn rejects_invalid_theme() {
        let s = Settings { theme: "neon".into(), ..create_settings() };
        assert!(matches!(validate(&s), Err(SettingsError::InvalidTheme(_))));
    }

    #[test]
    fn rejects_backup_count_out_of_range() {
        let s = Settings { backup_count: 0, ..create_settings() };
        assert_eq!(validate(&s), Err(SettingsError::InvalidBackupCount));
        let s = Settings { backup_count: 101, ..create_settings() };
        assert_eq!(validate(&s), Err(SettingsError::InvalidBackupCount));
    }

    #[test]
    fn rejects_password_generator_with_no_charset_enabled() {
        let mut s = create_settings();
        s.password_generator.uppercase = false;
        s.password_generator.lowercase = false;
        s.password_generator.numbers = false;
        s.password_generator.symbols = false;
        assert_eq!(validate(&s), Err(SettingsError::NoPasswordGeneratorCharsetEnabled));
    }

    #[test]
    fn rejects_malformed_hex_colors() {
        let s = Settings { accent_color: Some("not-a-color".into()), ..create_settings() };
        assert!(matches!(validate(&s), Err(SettingsError::InvalidHexColor(_, _))));
        let s = Settings { accent_color: Some("#fff".into()), ..create_settings() }; // 3-digit, not 6
        assert!(matches!(validate(&s), Err(SettingsError::InvalidHexColor(_, _))));
    }

    #[test]
    fn accepts_null_colors() {
        let s = Settings { accent_color: None, background_color: None, panel_color: None, ..create_settings() };
        assert!(validate(&s).is_ok());
    }

    #[test]
    fn rejects_background_image_without_data_uri_prefix() {
        let s = Settings { background_image: Some("not-a-data-uri".into()), ..create_settings() };
        assert_eq!(validate(&s), Err(SettingsError::InvalidBackgroundImage));
    }

    #[test]
    fn update_rejects_invalid_merged_result_without_mutating() {
        let current = create_settings();
        let result = update(
            &current,
            crate::model::SettingsUpdate { backup_count: Some(0), ..Default::default() },
        );
        assert!(result.is_err());
    }
}
