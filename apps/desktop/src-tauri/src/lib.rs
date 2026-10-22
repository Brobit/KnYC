mod settings;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::default())
        .invoke_handler(tauri::generate_handler![
            settings::settings_read,
            settings::settings_write,
            workspace::workspace_pick,
            workspace::workspace_open,
            workspace::workspace_close,
            workspace::workspace_tree,
            workspace::workspace_list,
            workspace::workspace_read,
            workspace::workspace_write,
            workspace::workspace_create_file,
            workspace::workspace_create_dir,
            workspace::workspace_rename,
            workspace::workspace_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
