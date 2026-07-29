mod activity_log;
mod backup;
mod command_manager;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
