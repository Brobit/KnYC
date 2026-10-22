//! The Run panel (issue #35): the project's commands from the scan, started in the workspace with
//! live output, stopped with their whole process tree, and stopped with the workspace or the app.

use knyc_analyzer::scan::{ScanOptions, scan};
use knyc_runner::stream::{Finished, RunningCommand, StreamCallbacks, StreamKind};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::workspace::WorkspaceState;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCommand {
    /// "install" | "build" | "test" | "run" | "script"
    pub kind: &'static str,
    /// The script name for scripts, else the kind.
    pub name: String,
    pub command: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageCommands {
    /// Folder of the package.json, relative to the workspace ("." for the root).
    pub root: String,
    pub name: Option<String>,
    pub commands: Vec<ProjectCommand>,
}

/// The scan's install / build / test / run commands, then every other package.json script.
pub fn package_commands(
    root: &str,
    name: Option<String>,
    package_manager: &str,
    standard: [(&'static str, Option<&String>); 4],
    scripts: &BTreeMap<String, String>,
) -> PackageCommands {
    let mut commands: Vec<ProjectCommand> = standard
        .into_iter()
        .filter_map(|(kind, command)| {
            command.map(|c| ProjectCommand {
                kind,
                name: kind.to_string(),
                command: c.clone(),
            })
        })
        .collect();
    for script in scripts.keys() {
        let command = format!("{package_manager} run {script}");
        if !commands.iter().any(|c| c.command == command) {
            commands.push(ProjectCommand {
                kind: "script",
                name: script.clone(),
                command,
            });
        }
    }
    PackageCommands {
        root: root.to_string(),
        name,
        commands,
    }
}

#[tauri::command]
pub async fn run_commands(
    workspace: State<'_, WorkspaceState>,
) -> Result<Vec<PackageCommands>, String> {
    let root = workspace.root().ok_or("no folder is open")?;
    let scanned = tauri::async_runtime::spawn_blocking(move || {
        scan(
            &root,
            ScanOptions {
                detect_toolchains: false,
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))?;
    Ok(scanned
        .packages
        .iter()
        .zip(&scanned.commands)
        .map(|(package, commands)| {
            package_commands(
                &package.root,
                package.name.clone(),
                package.package_manager,
                [
                    ("install", commands.install.as_ref()),
                    ("build", commands.build.as_ref()),
                    ("test", commands.test.as_ref()),
                    ("run", commands.run.as_ref()),
                ],
                &package.scripts,
            )
        })
        .collect())
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RunEvent {
    Output {
        stream: StreamKind,
        data: String,
    },
    #[serde(rename_all = "camelCase")]
    Exit {
        exit_code: Option<i32>,
        duration_ms: u64,
        stopped: bool,
    },
}

#[derive(Default)]
pub struct RunState {
    next_id: AtomicU32,
    running: Mutex<HashMap<u32, RunningCommand>>,
}

impl RunState {
    /// Stops every command (and what it started): a new folder, or the app closing.
    pub fn stop_all(&self) {
        if let Ok(mut running) = self.running.lock() {
            running.clear();
        }
    }
}

/// Starts `command` in the package folder `root` (relative to the workspace).
#[tauri::command]
pub fn run_start(
    app: AppHandle,
    runs: State<'_, RunState>,
    workspace: State<'_, WorkspaceState>,
    command: String,
    root: String,
    on_event: Channel<RunEvent>,
) -> Result<u32, String> {
    let cwd = workspace.resolve(&root).map_err(|e| format!("{e:?}"))?;
    let id = runs.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let output = on_event.clone();
    let running = RunningCommand::start(
        &command,
        &cwd,
        &BTreeMap::new(),
        StreamCallbacks {
            on_output: Box::new(move |stream, data| {
                let _ = output.send(RunEvent::Output { stream, data });
            }),
            on_exit: Box::new(
                move |Finished {
                          exit_code,
                          duration_ms,
                          stopped,
                      }| {
                    let _ = on_event.send(RunEvent::Exit {
                        exit_code,
                        duration_ms,
                        stopped,
                    });
                    if let Ok(mut running) = app.state::<RunState>().running.lock() {
                        running.remove(&id);
                    }
                },
            ),
        },
    )
    .map_err(|e| format!("{e:#}"))?;
    runs.running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, running);
    Ok(id)
}

#[tauri::command]
pub fn run_stop(runs: State<'_, RunState>, id: u32) -> Result<(), String> {
    let running = runs.running.lock().map_err(|e| e.to_string())?;
    // The exit event follows, once every process of the tree is gone.
    if let Some(command) = running.get(&id) {
        command.stop();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_commands_first_then_other_scripts() {
        let scripts: BTreeMap<String, String> = [
            ("build", "tsc"),
            ("dev", "node --watch src/server.js"),
            ("lint", "eslint ."),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let install = "npm ci".to_string();
        let build = "npm run build".to_string();
        let run = "npm run dev".to_string();
        let package = package_commands(
            ".",
            Some("notes".into()),
            "npm",
            [
                ("install", Some(&install)),
                ("build", Some(&build)),
                ("test", None),
                ("run", Some(&run)),
            ],
            &scripts,
        );
        let listed: Vec<_> = package
            .commands
            .iter()
            .map(|c| (c.kind, c.name.as_str(), c.command.as_str()))
            .collect();
        assert_eq!(
            listed,
            vec![
                ("install", "install", "npm ci"),
                ("build", "build", "npm run build"),
                ("run", "run", "npm run dev"),
                ("script", "lint", "npm run lint"),
            ]
        );
    }
}
