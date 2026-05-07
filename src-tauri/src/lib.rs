mod api;
mod config;
mod commands;
mod export;
mod index;
mod state;
mod sync;
mod types;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::save_token,
            commands::get_settings,
            commands::save_settings,
            commands::select_export_dir,
            commands::get_sync_snapshot,
            commands::cancel_sync,
            commands::start_sync
        ])
        .run(tauri::generate_context!())
        .expect("failed to run biji2md");
}
