// Rust port of src/models/Settings.js.

use serde::{Deserialize, Serialize};

pub const THEMES: &[&str] = &["light", "dark", "system"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PasswordGeneratorSettings {
    pub length: i64,
    pub uppercase: bool,
    pub lowercase: bool,
    pub numbers: bool,
    pub symbols: bool,
    #[serde(rename = "excludeAmbiguous")]
    pub exclude_ambiguous: bool,
}

impl Default for PasswordGeneratorSettings {
    fn default() -> Self {
        Self { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, exclude_ambiguous: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    pub theme: String,
    #[serde(rename = "autoLockMinutes")]
    pub auto_lock_minutes: f64,
    #[serde(rename = "backupCount")]
    pub backup_count: i64,
    #[serde(rename = "passwordGenerator")]
    pub password_generator: PasswordGeneratorSettings,
    #[serde(rename = "recentFileLimit")]
    pub recent_file_limit: i64,
    #[serde(rename = "clipboardClearSeconds")]
    pub clipboard_clear_seconds: f64,
    #[serde(rename = "passwordHistoryLimit")]
    pub password_history_limit: i64,
    #[serde(rename = "accentColor")]
    pub accent_color: Option<String>,
    #[serde(rename = "backgroundColor")]
    pub background_color: Option<String>,
    #[serde(rename = "backgroundImage")]
    pub background_image: Option<String>,
    #[serde(rename = "panelColor")]
    pub panel_color: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            auto_lock_minutes: 5.0,
            backup_count: 5,
            password_generator: PasswordGeneratorSettings::default(),
            recent_file_limit: 10,
            clipboard_clear_seconds: 20.0,
            password_history_limit: 20,
            accent_color: None,
            background_color: None,
            background_image: None,
            panel_color: None,
        }
    }
}

pub fn create_settings() -> Settings {
    Settings::default()
}

/// `Option<Option<T>>` alone can't tell "key absent" apart from "key
/// present with JSON null" - serde's Option deserializer collapses both to
/// the outer `None` unless the field also carries `#[serde(default)]`
/// *and* runs its value (when present) through this, which re-wraps
/// whatever `Option<T>` came out (null -> None, a value -> Some(value)) in
/// an extra `Some(..)` layer to mark "the key was present at all".
/// Verified empirically - see the migration notes for the test that caught
/// this before it shipped as a silent "clearing a color does nothing" bug.
fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

/// Partial update as sent over IPC - every field optional, `None` means
/// "leave unchanged" (mirrors JS's `updateSettings(settings, updates = {})`
/// spread-merge semantics). The four nullable color/image fields need the
/// `double_option` treatment above so an explicit `null` (clear it) is
/// distinguishable from the key being absent (leave it alone).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub theme: Option<String>,
    pub auto_lock_minutes: Option<f64>,
    pub backup_count: Option<i64>,
    pub password_generator: Option<PasswordGeneratorUpdate>,
    pub recent_file_limit: Option<i64>,
    pub clipboard_clear_seconds: Option<f64>,
    pub password_history_limit: Option<i64>,
    #[serde(default, deserialize_with = "double_option")]
    pub accent_color: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub background_color: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub background_image: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub panel_color: Option<Option<String>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordGeneratorUpdate {
    pub length: Option<i64>,
    pub uppercase: Option<bool>,
    pub lowercase: Option<bool>,
    pub numbers: Option<bool>,
    pub symbols: Option<bool>,
    pub exclude_ambiguous: Option<bool>,
}

pub fn update_settings(settings: &Settings, updates: SettingsUpdate) -> Settings {
    let mut next = settings.clone();
    if let Some(theme) = updates.theme {
        next.theme = theme;
    }
    if let Some(v) = updates.auto_lock_minutes {
        next.auto_lock_minutes = v;
    }
    if let Some(v) = updates.backup_count {
        next.backup_count = v;
    }
    if let Some(v) = updates.recent_file_limit {
        next.recent_file_limit = v;
    }
    if let Some(v) = updates.clipboard_clear_seconds {
        next.clipboard_clear_seconds = v;
    }
    if let Some(v) = updates.password_history_limit {
        next.password_history_limit = v;
    }
    if let Some(v) = updates.accent_color {
        next.accent_color = v;
    }
    if let Some(v) = updates.background_color {
        next.background_color = v;
    }
    if let Some(v) = updates.background_image {
        next.background_image = v;
    }
    if let Some(v) = updates.panel_color {
        next.panel_color = v;
    }
    if let Some(pg) = updates.password_generator {
        if let Some(v) = pg.length {
            next.password_generator.length = v;
        }
        if let Some(v) = pg.uppercase {
            next.password_generator.uppercase = v;
        }
        if let Some(v) = pg.lowercase {
            next.password_generator.lowercase = v;
        }
        if let Some(v) = pg.numbers {
            next.password_generator.numbers = v;
        }
        if let Some(v) = pg.symbols {
            next.password_generator.symbols = v;
        }
        if let Some(v) = pg.exclude_ambiguous {
            next.password_generator.exclude_ambiguous = v;
        }
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_documented_values() {
        let s = create_settings();
        assert_eq!(s.theme, "system");
        assert_eq!(s.backup_count, 5);
        assert_eq!(s.password_generator.length, 20);
        assert_eq!(s.accent_color, None);
    }

    #[test]
    fn update_settings_merges_password_generator_instead_of_replacing() {
        let s = create_settings();
        let updated = update_settings(
            &s,
            SettingsUpdate {
                password_generator: Some(PasswordGeneratorUpdate { length: Some(32), ..Default::default() }),
                ..Default::default()
            },
        );
        assert_eq!(updated.password_generator.length, 32);
        assert!(updated.password_generator.uppercase); // untouched fields survive
    }

    #[test]
    fn update_settings_can_clear_an_optional_color_back_to_none() {
        let s = Settings { accent_color: Some("#667eea".into()), ..create_settings() };
        let updated = update_settings(&s, SettingsUpdate { accent_color: Some(None), ..Default::default() });
        assert_eq!(updated.accent_color, None);
    }

    /// Exercises the actual JSON deserialization boundary (not just Rust
    /// struct construction) - this is what would have caught the
    /// double_option bug: without it, an absent key and an explicit `null`
    /// both deserialize to the same `None`, so "clear the color" and
    /// "don't touch it" become silently identical.
    #[test]
    fn json_boundary_distinguishes_absent_key_from_explicit_null() {
        let absent: SettingsUpdate = serde_json::from_str("{}").unwrap();
        assert_eq!(absent.accent_color, None, "key absent -> leave unchanged");

        let cleared: SettingsUpdate = serde_json::from_str(r#"{"accentColor": null}"#).unwrap();
        assert_eq!(cleared.accent_color, Some(None), "explicit null -> clear it");

        let set: SettingsUpdate = serde_json::from_str(r##"{"accentColor": "#667eea"}"##).unwrap();
        assert_eq!(set.accent_color, Some(Some("#667eea".to_string())));

        // And that this actually flows correctly through update_settings():
        let base = Settings { accent_color: Some("#111111".into()), ..create_settings() };
        assert_eq!(update_settings(&base, absent).accent_color, Some("#111111".into()));
        let base2 = Settings { accent_color: Some("#111111".into()), ..create_settings() };
        assert_eq!(update_settings(&base2, cleared).accent_color, None);
    }
}
