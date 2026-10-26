mod ai;
mod keychain;
mod pipeline;
mod providers;
mod run;
mod settings;
mod shell_path;
mod terminal;
mod workspace;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything spawns a program: a Finder-opened app only has the system PATH.
    shell_path::adopt_shell_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Install links (onboarding): https pages only, see capabilities/default.json.
        .plugin(tauri_plugin_opener::init())
        .manage(workspace::WorkspaceState::default())
        .manage(terminal::TerminalState::default())
        .manage(run::RunState::default())
        .manage(pipeline::PipelineState::default())
        .manage(ai::AiState::default())
        .invoke_handler(tauri::generate_handler![
            settings::settings_read,
            settings::settings_write,
            settings::workspaces_read,
            settings::workspaces_write,
            keychain::keychain_set,
            keychain::keychain_hint,
            keychain::keychain_delete,
            providers::claude_cli_status,
            providers::toolchains_status,
            ai::ai_claude_call,
            ai::ai_claude_cancel,
            workspace::workspace_pick,
            workspace::workspace_open,
            workspace::workspace_create,
            workspace::workspace_check_run,
            workspace::workspace_exists,
            workspace::workspace_read_for_ai,
            workspace::workspace_snapshot,
            workspace::workspace_http_check,
            workspace::workspace_docker_check,
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
            run::run_stop,
            pipeline::pipeline_data_dir,
            pipeline::pipeline_pick_source,
            pipeline::pipeline_choose_folder,
            pipeline::host_read_file,
            pipeline::host_write_file,
            pipeline::host_append_file,
            pipeline::host_copy_file,
            pipeline::host_remove,
            pipeline::host_git,
            pipeline::host_sys
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // No shell, command or AI call outlives the app.
            if let RunEvent::Exit = event {
                app.state::<terminal::TerminalState>().close_all();
                app.state::<run::RunState>().stop_all();
                app.state::<ai::AiState>().cancel_all();
            }
        });
}
