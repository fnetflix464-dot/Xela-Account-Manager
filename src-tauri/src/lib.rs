mod activity_log;
mod backup;
mod command_manager;
mod commands;
mod crypto;
mod model;
mod quick_unlock;
mod recycle_bin;
mod search;
mod settings_service;
mod time_util;
mod vault_file;
mod vault_repository;
mod vault_service;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let state = commands::build_app_state(&app.handle().clone());
      app.manage(state);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::set_window_mode,
      commands::check_master_password_exists,
      commands::check_vault_health,
      commands::set_master_password,
      commands::verify_master_password,
      commands::lock_vault,
      commands::change_master_password,
      commands::is_quick_unlock_available,
      commands::is_quick_unlock_enabled,
      commands::enable_quick_unlock,
      commands::disable_quick_unlock,
      commands::unlock_with_pin,
      commands::get_vault_tree,
      commands::add_category,
      commands::rename_category,
      commands::delete_category,
      commands::add_folder,
      commands::rename_folder,
      commands::delete_folder,
      commands::move_folder,
      commands::add_entry,
      commands::update_entry,
      commands::delete_entry,
      commands::move_entry,
      commands::duplicate_entry,
      commands::toggle_favorite,
      commands::list_favorites,
      commands::list_recent_entries,
      commands::list_recent_activity,
      commands::find_reused_passwords,
      commands::record_error,
      commands::get_recycle_bin,
      commands::restore_from_recycle_bin,
      commands::permanently_delete,
      commands::empty_recycle_bin,
      commands::undo,
      commands::redo,
      commands::get_undo_state,
      commands::search_vault,
      commands::get_settings,
      commands::update_settings,
      commands::list_backups,
      commands::restore_backup,
      commands::delete_backup,
      commands::rename_backup,
      commands::export_backup,
      commands::export_vault,
      commands::import_vault,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
