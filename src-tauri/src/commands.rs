// Tauri command layer - the Rust equivalent of public/electron.js's 50
// ipcMain.handle() channels + preload.cjs's contextBridge surface. Every
// command here is a thin wrapper around a VaultService/CommandManager
// call; errors are converted to String (VaultServiceError's Display,
// via thiserror) so they surface to the renderer as a rejected invoke()
// promise instead of electron.js's old {success, error} envelope.

use crate::command_manager::{self, CommandManager, UndoableCommand};
use crate::model::entry::CreateEntryOptions;
use crate::model::{Category, Entry, Folder, Settings, SettingsUpdate};
use crate::quick_unlock::OsKeyring;
use crate::search::SearchResult;
use crate::vault_service::{EntryFieldsUpdate, ReusedPasswordEntry, VaultService, VaultServiceConfig};
use serde::Serialize;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    pub vault_service: Mutex<VaultService>,
    pub command_manager: Mutex<CommandManager>,
}

pub fn vault_file_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app_data_dir resolvable").join("vault.xam")
}

pub fn backup_dir_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app_data_dir resolvable").join("backups")
}

pub fn quick_unlock_file_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app_data_dir resolvable").join("quickunlock.dat")
}

pub fn build_app_state(app: &AppHandle) -> AppState {
    let config = VaultServiceConfig {
        vault_file_path: vault_file_path(app),
        backup_dir: backup_dir_path(app),
        quick_unlock_file_path: Some(quick_unlock_file_path(app)),
    };
    AppState {
        vault_service: Mutex::new(VaultService::new(config, Box::new(OsKeyring::new()))),
        command_manager: Mutex::new(CommandManager::new()),
    }
}

fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn notify_stack_changed(app: &AppHandle, cm: &CommandManager) {
    let payload = json!({
        "action": "command.stackChanged",
        "details": { "canUndo": cm.can_undo(), "canRedo": cm.can_redo() },
        "timestamp": crate::time_util::now_iso8601(),
    });
    let _ = app.emit("vault-event", payload);
}

/// Forwards every VaultEvent recorded since the last drain to the
/// renderer on the same "vault-event" channel electron.js used, and
/// clears the undo/redo stack on vault lifecycle transitions - mirroring
/// CommandManager.js's eventBus listener for CLEARING_ACTIONS, which ran
/// synchronously off the same event.
fn forward_events(app: &AppHandle, vault_service: &mut VaultService, command_manager: &Mutex<CommandManager>) {
    for event in vault_service.drain_events() {
        let payload = json!({ "action": event.action, "details": event.details, "timestamp": event.timestamp });
        let _ = app.emit("vault-event", payload);
        if command_manager::is_clearing_action(&event.action) {
            let mut cm = command_manager.lock().unwrap();
            cm.clear();
            notify_stack_changed(app, &cm);
        }
    }
}

/// Runs `run` as an undoable command: snapshots the vault before/after,
/// same whole-vault-snapshot approach as VaultMutationCommand.js. Used
/// only for mutations where undo/redo makes sense - excluded are settings
/// changes, master-password/import/restore-backup (change the vault's
/// encryption identity, not just its content), and permanent deletion
/// (the UI promises those "cannot be undone").
fn with_undo<T>(
    app: &AppHandle,
    state: &State<AppState>,
    label: &str,
    run: impl FnOnce(&mut VaultService) -> Result<T, crate::vault_service::VaultServiceError>,
) -> Result<T, String> {
    let mut vs = state.vault_service.lock().unwrap();
    let before = vs.get_vault().map_err(to_err)?.clone();
    let result = run(&mut vs).map_err(to_err)?;
    let after = vs.get_vault().map_err(to_err)?.clone();
    forward_events(app, &mut vs, &state.command_manager);
    drop(vs);

    let mut cm = state.command_manager.lock().unwrap();
    cm.push(UndoableCommand { label: label.to_string(), before, after });
    notify_stack_changed(app, &cm);
    Ok(result)
}

// ==================== WINDOW ====================

const LOGIN_WINDOW: (f64, f64, f64, f64) = (520.0, 700.0, 460.0, 600.0); // width, height, minWidth, minHeight
const APP_WINDOW: (f64, f64, f64, f64) = (1280.0, 840.0, 900.0, 600.0);

#[tauri::command]
pub fn set_window_mode(app: AppHandle, mode: String) -> Result<bool, String> {
    let Some(window) = app.get_webview_window("main") else { return Ok(true) };
    let (width, height, min_width, min_height) = if mode == "app" { APP_WINDOW } else { LOGIN_WINDOW };
    if window.is_maximized().map_err(to_err)? {
        window.unmaximize().map_err(to_err)?;
    }
    window
        .set_min_size(Some(tauri::LogicalSize::new(min_width, min_height)))
        .map_err(to_err)?;
    window.set_size(tauri::LogicalSize::new(width, height)).map_err(to_err)?;
    window.center().map_err(to_err)?;
    Ok(true)
}

// ==================== MASTER PASSWORD / VAULT LIFECYCLE ====================

#[derive(Serialize)]
pub struct ExistsResult {
    exists: bool,
}
#[tauri::command]
pub fn check_master_password_exists(state: State<AppState>) -> ExistsResult {
    ExistsResult { exists: state.vault_service.lock().unwrap().vault_file_exists() }
}

#[derive(Serialize)]
pub struct HealthyResult {
    healthy: bool,
}
#[tauri::command]
pub fn check_vault_health(state: State<AppState>) -> HealthyResult {
    HealthyResult { healthy: state.vault_service.lock().unwrap().is_vault_file_healthy() }
}

#[tauri::command]
pub fn set_master_password(app: AppHandle, state: State<AppState>, password: String) -> Result<bool, String> {
    let mut vs = state.vault_service.lock().unwrap();
    vs.create(&password).map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(true)
}

#[tauri::command]
pub fn verify_master_password(app: AppHandle, state: State<AppState>, password: String) -> Result<bool, String> {
    let mut vs = state.vault_service.lock().unwrap();
    vs.unlock(&password).map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(true)
}

#[tauri::command]
pub fn lock_vault(app: AppHandle, state: State<AppState>) -> Result<bool, String> {
    let mut vs = state.vault_service.lock().unwrap();
    vs.lock();
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(true)
}

#[tauri::command]
pub fn change_master_password(
    app: AppHandle,
    state: State<AppState>,
    current_password: String,
    new_password: String,
) -> Result<bool, String> {
    let mut vs = state.vault_service.lock().unwrap();
    vs.change_master_password(&current_password, &new_password).map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(true)
}

// ---- PIN quick unlock ----

#[derive(Serialize)]
pub struct AvailableResult {
    available: bool,
}
#[tauri::command]
pub fn is_quick_unlock_available(state: State<AppState>) -> AvailableResult {
    AvailableResult { available: state.vault_service.lock().unwrap().is_quick_unlock_available() }
}

#[derive(Serialize)]
pub struct EnabledResult {
    enabled: bool,
}
#[tauri::command]
pub fn is_quick_unlock_enabled(state: State<AppState>) -> EnabledResult {
    EnabledResult { enabled: state.vault_service.lock().unwrap().is_quick_unlock_enabled() }
}

#[tauri::command]
pub fn enable_quick_unlock(state: State<AppState>, pin: String) -> Result<bool, String> {
    state.vault_service.lock().unwrap().enable_quick_unlock(&pin).map_err(to_err)?;
    Ok(true)
}

#[tauri::command]
pub fn disable_quick_unlock(state: State<AppState>) -> Result<bool, String> {
    state.vault_service.lock().unwrap().disable_quick_unlock().map_err(to_err)?;
    Ok(true)
}

#[tauri::command]
pub fn unlock_with_pin(app: AppHandle, state: State<AppState>, pin: String) -> Result<bool, String> {
    let mut vs = state.vault_service.lock().unwrap();
    vs.unlock_with_pin(&pin).map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(true)
}

// ==================== CATEGORIES ====================

#[tauri::command]
pub fn get_vault_tree(state: State<AppState>) -> Result<Vec<Category>, String> {
    Ok(state.vault_service.lock().unwrap().get_vault().map_err(to_err)?.categories.clone())
}

#[tauri::command]
pub fn add_category(app: AppHandle, state: State<AppState>, name: String, icon: Option<String>) -> Result<Category, String> {
    with_undo(&app, &state, "Add category", |vs| vs.add_category(&name, icon.as_deref()))
}

#[tauri::command]
pub fn rename_category(app: AppHandle, state: State<AppState>, category_id: String, name: String) -> Result<(), String> {
    with_undo(&app, &state, "Rename category", |vs| vs.rename_category(&category_id, &name))
}

#[tauri::command]
pub fn delete_category(app: AppHandle, state: State<AppState>, category_id: String) -> Result<(), String> {
    with_undo(&app, &state, "Delete category", |vs| vs.delete_category(&category_id))
}

// ==================== FOLDERS ====================

#[tauri::command]
pub fn add_folder(
    app: AppHandle,
    state: State<AppState>,
    category_id: String,
    parent_folder_id: Option<String>,
    name: String,
) -> Result<Folder, String> {
    with_undo(&app, &state, "Add folder", |vs| vs.add_folder(&category_id, parent_folder_id.as_deref(), &name))
}

#[tauri::command]
pub fn rename_folder(app: AppHandle, state: State<AppState>, category_id: String, folder_id: String, name: String) -> Result<(), String> {
    with_undo(&app, &state, "Rename folder", |vs| vs.rename_folder(&category_id, &folder_id, &name))
}

#[tauri::command]
pub fn delete_folder(app: AppHandle, state: State<AppState>, category_id: String, folder_id: String) -> Result<(), String> {
    with_undo(&app, &state, "Delete folder", |vs| vs.delete_folder(&category_id, &folder_id))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn move_folder(
    app: AppHandle,
    state: State<AppState>,
    folder_id: String,
    target_category_id: String,
    target_parent_folder_id: Option<String>,
    before_folder_id: Option<String>,
) -> Result<(), String> {
    with_undo(&app, &state, "Move folder", |vs| {
        vs.move_folder(&folder_id, &target_category_id, target_parent_folder_id.as_deref(), before_folder_id.as_deref())
    })
}

// ==================== ENTRIES ====================

#[tauri::command]
pub fn add_entry(
    app: AppHandle,
    state: State<AppState>,
    category_id: String,
    folder_id: String,
    entry_data: EntryDataInput,
) -> Result<Entry, String> {
    with_undo(&app, &state, "Add entry", |vs| vs.add_entry(&category_id, &folder_id, entry_data.into()))
}

/// Shape the renderer sends when creating an entry - a subset of
/// CreateEntryOptions since IDs/timestamps are minted server-side.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDataInput {
    pub title: String,
    #[serde(default = "default_template")]
    pub template: String,
    pub icon: Option<String>,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}
fn default_template() -> String {
    "Custom".to_string()
}
fn default_color() -> String {
    "#4a90d9".to_string()
}
impl From<EntryDataInput> for CreateEntryOptions {
    fn from(v: EntryDataInput) -> Self {
        CreateEntryOptions { title: v.title, template: v.template, icon: v.icon, color: v.color, favorite: v.favorite, tags: v.tags, fields: None }
    }
}

#[tauri::command]
pub fn update_entry(app: AppHandle, state: State<AppState>, entry_id: String, updates: EntryFieldsUpdate) -> Result<Entry, String> {
    with_undo(&app, &state, "Update entry", |vs| vs.update_entry_fields(&entry_id, updates))
}

#[tauri::command]
pub fn delete_entry(app: AppHandle, state: State<AppState>, entry_id: String) -> Result<(), String> {
    with_undo(&app, &state, "Delete entry", |vs| vs.delete_entry(&entry_id))
}

#[tauri::command]
pub fn move_entry(app: AppHandle, state: State<AppState>, entry_id: String, target_category_id: String, target_folder_id: String) -> Result<(), String> {
    with_undo(&app, &state, "Move entry", |vs| vs.move_entry(&entry_id, &target_category_id, &target_folder_id))
}

#[tauri::command]
pub fn duplicate_entry(app: AppHandle, state: State<AppState>, entry_id: String) -> Result<Entry, String> {
    with_undo(&app, &state, "Duplicate entry", |vs| vs.duplicate_entry_by_id(&entry_id))
}

#[tauri::command]
pub fn toggle_favorite(app: AppHandle, state: State<AppState>, entry_id: String) -> Result<Entry, String> {
    with_undo(&app, &state, "Toggle favorite", |vs| vs.toggle_favorite(&entry_id))
}

#[tauri::command]
pub fn list_favorites(state: State<AppState>) -> Result<Vec<Entry>, String> {
    state.vault_service.lock().unwrap().list_favorites().map_err(to_err)
}

#[tauri::command]
pub fn list_recent_entries(state: State<AppState>, limit: Option<usize>) -> Result<Vec<Entry>, String> {
    state.vault_service.lock().unwrap().list_recent_entries(limit.unwrap_or(10)).map_err(to_err)
}

#[tauri::command]
pub fn list_recent_activity(state: State<AppState>, limit: Option<usize>) -> Result<Vec<crate::model::ActivityLogEntry>, String> {
    state.vault_service.lock().unwrap().list_recent_activity(limit.unwrap_or(20)).map_err(to_err)
}

#[tauri::command]
pub fn find_reused_passwords(state: State<AppState>) -> Result<Vec<Vec<ReusedPasswordEntry>>, String> {
    state.vault_service.lock().unwrap().find_reused_passwords().map_err(to_err)
}

#[tauri::command]
pub fn record_error(app: AppHandle, state: State<AppState>, message: String, stack: String) -> Result<bool, String> {
    let mut vs = state.vault_service.lock().unwrap();
    vs.record_error(&message, &stack);
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(true)
}

// ==================== RECYCLE BIN ====================

#[tauri::command]
pub fn get_recycle_bin(state: State<AppState>) -> Result<Vec<crate::model::RecycleBinRecord>, String> {
    Ok(state.vault_service.lock().unwrap().get_vault().map_err(to_err)?.recycle_bin.clone())
}

#[tauri::command]
pub fn restore_from_recycle_bin(app: AppHandle, state: State<AppState>, recycle_id: String) -> Result<(), String> {
    with_undo(&app, &state, "Restore from recycle bin", |vs| vs.restore_from_recycle_bin(&recycle_id))
}

/// Permanent deletion is intentionally NOT undoable - the Recycle Bin UI
/// explicitly tells the user these actions "cannot be undone".
#[tauri::command]
pub fn permanently_delete(app: AppHandle, state: State<AppState>, recycle_id: String) -> Result<(), String> {
    let mut vs = state.vault_service.lock().unwrap();
    vs.permanently_delete(&recycle_id).map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(())
}

#[tauri::command]
pub fn empty_recycle_bin(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let mut vs = state.vault_service.lock().unwrap();
    vs.empty_recycle_bin().map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(())
}

// ==================== UNDO / REDO ====================

#[tauri::command]
pub fn undo(app: AppHandle, state: State<AppState>) -> Result<bool, String> {
    let snapshot = state.command_manager.lock().unwrap().undo();
    let Some(snapshot) = snapshot else { return Ok(false) };
    state.vault_service.lock().unwrap().restore_snapshot(snapshot).map_err(to_err)?;
    notify_stack_changed(&app, &state.command_manager.lock().unwrap());
    Ok(true)
}

#[tauri::command]
pub fn redo(app: AppHandle, state: State<AppState>) -> Result<bool, String> {
    let snapshot = state.command_manager.lock().unwrap().redo();
    let Some(snapshot) = snapshot else { return Ok(false) };
    state.vault_service.lock().unwrap().restore_snapshot(snapshot).map_err(to_err)?;
    notify_stack_changed(&app, &state.command_manager.lock().unwrap());
    Ok(true)
}

#[derive(Serialize)]
pub struct UndoState {
    #[serde(rename = "canUndo")]
    can_undo: bool,
    #[serde(rename = "canRedo")]
    can_redo: bool,
}
#[tauri::command]
pub fn get_undo_state(state: State<AppState>) -> UndoState {
    let cm = state.command_manager.lock().unwrap();
    UndoState { can_undo: cm.can_undo(), can_redo: cm.can_redo() }
}

// ==================== SEARCH ====================

#[tauri::command]
pub fn search_vault(state: State<AppState>, query: String) -> Result<Vec<SearchResult>, String> {
    state.vault_service.lock().unwrap().search(&query).map_err(to_err)
}

// ==================== SETTINGS ====================

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    Ok(state.vault_service.lock().unwrap().get_settings().map_err(to_err)?.clone())
}

#[tauri::command]
pub fn update_settings(app: AppHandle, state: State<AppState>, updates: SettingsUpdate) -> Result<Settings, String> {
    let mut vs = state.vault_service.lock().unwrap();
    let result = vs.update_vault_settings(updates).map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(result)
}

// ==================== BACKUP / IMPORT / EXPORT ====================

#[tauri::command]
pub fn list_backups(state: State<AppState>) -> Vec<PathBuf> {
    state.vault_service.lock().unwrap().list_backups()
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, state: State<AppState>, backup_path: PathBuf) -> Result<bool, String> {
    let mut vs = state.vault_service.lock().unwrap();
    vs.restore_backup(&backup_path).map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(true)
}

#[tauri::command]
pub fn delete_backup(state: State<AppState>, backup_path: PathBuf) -> Result<bool, String> {
    state.vault_service.lock().unwrap().delete_backup(&backup_path).map_err(to_err)?;
    Ok(true)
}

#[tauri::command]
pub fn rename_backup(state: State<AppState>, backup_path: PathBuf, new_label: String) -> Result<PathBuf, String> {
    state.vault_service.lock().unwrap().rename_backup(&backup_path, &new_label).map_err(to_err)
}

#[tauri::command]
pub fn export_backup(app: AppHandle, state: State<AppState>, backup_path: PathBuf) -> Result<Option<PathBuf>, String> {
    let default_name = backup_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let picked = app
        .dialog()
        .file()
        .set_title("Export Backup")
        .set_file_name(&default_name)
        .add_filter("Xela Vault Backup", &["bak"])
        .blocking_save_file();
    refocus_main_window(&app);
    let Some(dest) = picked else { return Ok(None) };
    let dest_path = dest.into_path().map_err(to_err)?;
    state.vault_service.lock().unwrap().export_backup_to(&backup_path, &dest_path).map_err(to_err)?;
    Ok(Some(dest_path))
}

#[tauri::command]
pub fn export_vault(app: AppHandle, state: State<AppState>) -> Result<Option<PathBuf>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Export Vault")
        .set_file_name("vault-export.xam")
        .add_filter("Xela Vault", &["xam"])
        .blocking_save_file();
    refocus_main_window(&app);
    let Some(dest) = picked else { return Ok(None) };
    let dest_path = dest.into_path().map_err(to_err)?;
    let mut vs = state.vault_service.lock().unwrap();
    vs.export_vault_to(&dest_path).map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(Some(dest_path))
}

#[tauri::command]
pub fn import_vault(app: AppHandle, state: State<AppState>, password: String) -> Result<Option<PathBuf>, String> {
    let picked = app.dialog().file().set_title("Import Vault").add_filter("Xela Vault", &["xam"]).blocking_pick_file();
    refocus_main_window(&app);
    let Some(source) = picked else { return Ok(None) };
    let source_path = source.into_path().map_err(to_err)?;
    let mut vs = state.vault_service.lock().unwrap();
    vs.import_vault_from(&source_path, &password).map_err(to_err)?;
    forward_events(&app, &mut vs, &state.command_manager);
    Ok(Some(source_path))
}

/// Windows quirk (see electron.js's original refocusMainWindow): after a
/// native save/open dialog closes, the parent window can be left looking
/// focused but not actually receiving keyboard input until the user
/// manually alt-tabs away and back. Re-focus explicitly either way.
fn refocus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}
