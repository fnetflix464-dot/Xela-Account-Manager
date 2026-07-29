// Rust port of src/models/ + src/data/ - the vault's data model. Every
// struct here derives Serialize/Deserialize with field names matching the
// JS originals exactly (camelCase via #[serde(rename)]), since these are
// the same objects that get encrypted into vault.xam and exchanged with
// the renderer over IPC.

#![allow(dead_code, unused_imports)]

pub mod category;
pub mod data;
pub mod entry;
pub mod field;
pub mod folder;
pub mod password_history;
pub mod settings;
pub mod vault;

pub use category::{Category, CreateCategoryOptions};
pub use entry::{CreateEntryOptions, Entry, EntryUpdate};
pub use field::{CreateFieldOptions, Field, FieldUpdate, ModelError, PasswordHistoryEntry};
pub use folder::{CreateFolderOptions, Folder};
pub use settings::{PasswordGeneratorSettings, Settings, SettingsUpdate};
pub use vault::{ActivityLogEntry, RecycleBinRecord, Vault};
