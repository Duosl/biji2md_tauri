mod api;
mod cache;
mod commands;
mod config;
mod export;
mod history;
mod index;
mod log;
mod state;
mod sync;
mod types;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::check_update,
            commands::install_update,
            commands::get_app_version,
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
            commands::start_sync,
            commands::get_sync_logs,
            commands::get_dir_export_config,
            commands::get_cache_info,
            commands::reexport_from_cache,
            commands::reexport_from_cache_safe,
            commands::open_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("failed to run biji2md");
}
