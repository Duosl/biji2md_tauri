mod api;
mod commands;
mod config;
mod export;
mod history;
mod index;
mod state;
mod sync;
mod types;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_platform_info,
            commands::save_token,
            commands::clear_token,
            commands::get_settings,
            commands::save_settings,
            commands::save_setting_field,
            commands::select_export_dir,
            commands::open_export_dir,
            commands::get_sync_snapshot,
            commands::get_sync_overview,
            commands::cancel_sync,
            commands::start_sync
        ])
        .run(tauri::generate_context!())
        .expect("failed to run biji2md");
}
