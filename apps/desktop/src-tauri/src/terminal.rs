//! Terminals for the bottom panel (issue #34): shells started in the workspace folder, output
//! streamed to the UI over a channel per terminal, killed with the workspace or the app.

use knyc_runner::pty::{PtyCallbacks, PtySession, default_shell};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::workspace::WorkspaceState;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output { data: String },
    Exit { code: Option<u32> },
}

#[derive(Default)]
pub struct TerminalState {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, PtySession>>,
}

impl TerminalState {
    /// Kills every shell (and what runs in it): a new folder, or the app closing.
    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }

    fn with<T, E: std::fmt::Display>(
        &self,
        id: u32,
        action: impl FnOnce(&PtySession) -> Result<T, E>,
    ) -> Result<T, String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get(&id)
            .ok_or_else(|| format!("terminal {id} is closed"))?;
        action(session).map_err(|e| e.to_string())
    }
}

/// Starts the learner's shell in the workspace folder (or their home folder when none is open).
#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    terminals: State<'_, TerminalState>,
    workspace: State<'_, WorkspaceState>,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<u32, String> {
    let cwd = match workspace.root() {
        Some(root) => root,
        None => app.path().home_dir().map_err(|e| e.to_string())?,
    };
    let id = terminals.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let output = on_event.clone();
    let exit_app = app.clone();
    let session = PtySession::spawn(
        default_shell(),
        &cwd,
        cols.max(2),
        rows.max(1),
        PtyCallbacks {
            on_output: Box::new(move |data| {
                let _ = output.send(TerminalEvent::Output { data });
            }),
            on_exit: Box::new(move |code| {
                let _ = on_event.send(TerminalEvent::Exit { code });
                if let Ok(mut sessions) = exit_app.state::<TerminalState>().sessions.lock() {
                    sessions.remove(&id);
                }
            }),
        },
    )
    .map_err(|e| format!("{e:#}"))?;
    terminals
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, session);
    Ok(id)
}

#[tauri::command]
pub fn terminal_write(
    terminals: State<'_, TerminalState>,
    id: u32,
    data: String,
) -> Result<(), String> {
    terminals.with(id, |session| session.write(data.as_bytes()))
}

#[tauri::command]
pub fn terminal_resize(
    terminals: State<'_, TerminalState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    terminals.with(id, |session| session.resize(cols.max(2), rows.max(1)))
}

#[tauri::command]
pub fn terminal_close(terminals: State<'_, TerminalState>, id: u32) -> Result<(), String> {
    // Dropping the session kills the shell.
    terminals
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    Ok(())
}
