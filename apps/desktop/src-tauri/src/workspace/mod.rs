//! The workspace folder the learner works in (design 01): picked with the open-folder dialog,
//! then the only place file commands can read or write. Changes on disk are sent to the UI as
//! `workspace://changed` events.

mod scope;

pub use scope::{FsError, FsResult, Scope, TreeEntry};

use notify_debouncer_full::notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::run::RunState;
use crate::terminal::TerminalState;
use tauri_plugin_dialog::DialogExt;

pub const CHANGED_EVENT: &str = "workspace://changed";
const DEBOUNCE: Duration = Duration::from_millis(200);

type Watcher = Debouncer<notify_debouncer_full::notify::RecommendedWatcher, RecommendedCache>;

struct Open {
    scope: Scope,
    /// Dropping it stops the watcher.
    _watcher: Option<Watcher>,
}

#[derive(Default)]
pub struct WorkspaceState(Mutex<Option<Open>>);

impl WorkspaceState {
    /// The opened folder, if any (terminals start there).
    pub fn root(&self) -> Option<PathBuf> {
        let open = self.0.lock().ok()?;
        open.as_ref().map(|o| o.scope.root().to_path_buf())
    }

    /// A path inside the opened folder (see [`Scope::resolve`]).
    pub fn resolve(&self, rel: &str) -> FsResult<PathBuf> {
        self.scope()?.resolve(rel)
    }

    fn scope(&self) -> FsResult<Scope> {
        let open = self.0.lock().map_err(|e| FsError::Io(e.to_string()))?;
        open.as_ref()
            .map(|o| o.scope.clone())
            .ok_or_else(|| FsError::NoWorkspace("no folder is open".into()))
    }
}

#[derive(Debug, Serialize)]
pub struct WorkspaceInfo {
    pub root: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChangedPayload {
    /// Relative paths that were created, modified or removed (deduplicated, sorted).
    pub paths: Vec<String>,
}

/// Watches the folder recursively and hands each batch of changes to `send`. A watcher that
/// cannot start is not fatal: the tree just won't refresh by itself (the UI can still reload it).
fn watch(scope: &Scope, send: impl Fn(ChangedPayload) + Send + 'static) -> Option<Watcher> {
    let events_scope = scope.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let paths: BTreeSet<String> = events
            .iter()
            .flat_map(|event| event.paths.iter())
            .filter_map(|path| events_scope.relative(path))
            .filter(|rel| !rel.is_empty() && !scope::is_noise(rel))
            .collect();
        if !paths.is_empty() {
            send(ChangedPayload {
                paths: paths.into_iter().collect(),
            });
        }
    })
    .map_err(|e| eprintln!("workspace watcher could not start: {e}"))
    .ok()?;
    debouncer
        .watch(scope.root(), RecursiveMode::Recursive)
        .map_err(|e| {
            eprintln!(
                "workspace watcher could not watch {}: {e}",
                scope.root().display()
            )
        })
        .ok()?;
    Some(debouncer)
}

fn open_folder(app: &AppHandle, state: &WorkspaceState, path: PathBuf) -> FsResult<WorkspaceInfo> {
    let scope = Scope::new(&path)?;
    let info = WorkspaceInfo {
        root: scope.root().display().to_string(),
        name: scope
            .root()
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
    };
    // Shells belong to the folder they started in.
    app.state::<TerminalState>().close_all();
    app.state::<RunState>().stop_all();
    let app = app.clone();
    let watcher = watch(&scope, move |payload| {
        let _ = app.emit(CHANGED_EVENT, payload);
    });
    *state.0.lock().map_err(|e| FsError::Io(e.to_string()))? = Some(Open {
        scope,
        _watcher: watcher,
    });
    Ok(info)
}

/// Shows the open-folder dialog and opens the chosen folder; None when the learner cancels.
/// The dialog runs in Rust so the UI never hands over an arbitrary path to read from.
#[tauri::command]
pub async fn workspace_pick(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
) -> FsResult<Option<WorkspaceInfo>> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| FsError::Io(e.to_string()))?;
    open_folder(&app, &state, path).map(Some)
}

/// Reopens a folder the learner picked before (recent projects on Home).
#[tauri::command]
pub fn workspace_open(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    root: String,
) -> FsResult<WorkspaceInfo> {
    open_folder(&app, &state, PathBuf::from(root))
}

#[tauri::command]
pub fn workspace_close(app: AppHandle, state: State<'_, WorkspaceState>) -> FsResult<()> {
    app.state::<TerminalState>().close_all();
    app.state::<RunState>().stop_all();
    *state.0.lock().map_err(|e| FsError::Io(e.to_string()))? = None;
    Ok(())
}

#[tauri::command]
pub fn workspace_tree(state: State<'_, WorkspaceState>) -> FsResult<Vec<TreeEntry>> {
    state.scope()?.tree()
}

#[tauri::command]
pub fn workspace_list(state: State<'_, WorkspaceState>, path: String) -> FsResult<Vec<TreeEntry>> {
    state.scope()?.list(&path)
}

#[tauri::command]
pub fn workspace_read(state: State<'_, WorkspaceState>, path: String) -> FsResult<String> {
    state.scope()?.read_text(&path)
}

#[tauri::command]
pub fn workspace_write(
    state: State<'_, WorkspaceState>,
    path: String,
    content: String,
) -> FsResult<()> {
    state.scope()?.write_text(&path, &content)
}

#[tauri::command]
pub fn workspace_create_file(state: State<'_, WorkspaceState>, path: String) -> FsResult<()> {
    state.scope()?.create_file(&path)
}

#[tauri::command]
pub fn workspace_create_dir(state: State<'_, WorkspaceState>, path: String) -> FsResult<()> {
    state.scope()?.create_dir(&path)
}

#[tauri::command]
pub fn workspace_rename(
    state: State<'_, WorkspaceState>,
    from: String,
    to: String,
) -> FsResult<()> {
    state.scope()?.rename(&from, &to)
}

#[tauri::command]
pub fn workspace_delete(state: State<'_, WorkspaceState>, path: String) -> FsResult<()> {
    state.scope()?.delete(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_need_an_open_folder() {
        let state = WorkspaceState::default();
        assert!(matches!(state.scope(), Err(FsError::NoWorkspace(_))));
    }

    #[test]
    fn errors_serialize_with_a_kind() {
        let json = serde_json::to_string(&FsError::OutsideWorkspace("../x".into())).unwrap();
        assert_eq!(json, r#"{"kind":"outsideWorkspace","message":"../x"}"#);
    }

    #[test]
    fn watcher_reports_changes_but_not_noise() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("node_modules")).unwrap();
        let scope = Scope::new(dir.path()).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = watch(&scope, move |payload| {
            let _ = tx.send(payload.paths);
        })
        .expect("watcher starts");

        std::fs::write(dir.path().join("node_modules/pkg.js"), "").unwrap();
        scope.write_text("app.ts", "export {};\n").unwrap();

        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut seen = BTreeSet::new();
        while !seen.contains("app.ts") && std::time::Instant::now() < deadline {
            if let Ok(paths) = rx.recv_timeout(Duration::from_millis(500)) {
                seen.extend(paths);
            }
        }
        assert!(
            seen.contains("app.ts"),
            "no change event for app.ts, got {seen:?}"
        );
        assert!(
            seen.iter().all(|p| !scope::is_noise(p)),
            "noise leaked: {seen:?}"
        );
    }
}
