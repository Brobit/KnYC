mod run;
mod settings;
mod terminal;
mod workspace;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::default())
        .manage(terminal::TerminalState::default())
        .manage(run::RunState::default())
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
            workspace::workspace_delete,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            run::run_commands,
            run::run_start,
            run::run_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // No shell or command outlives the app.
            if let RunEvent::Exit = event {
                app.state::<terminal::TerminalState>().close_all();
                app.state::<run::RunState>().stop_all();
            }
        });
}
