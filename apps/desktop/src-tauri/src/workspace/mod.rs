//! The workspace folder the learner works in (design 01): picked with the open-folder dialog,
//! then the only place file commands can read or write. Changes on disk are sent to the UI as
//! `workspace://changed` events.

mod scope;
mod snapshots;

pub use scope::{FsError, FsResult, Scope, TreeEntry};

use knyc_analyzer::secrets::{is_secret_file, redact_secrets};
use knyc_runner::check::{CheckOutcome, run_check};
use knyc_runner::run::RunSpec;
use notify_debouncer_full::notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
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

/// Makes sure `path` can become a learner's workspace (#62): a new folder is created; an existing
/// one must be empty or already be a KnYC workspace, so nobody's project is ever written over.
fn prepare_workspace_folder(path: &Path) -> FsResult<()> {
    let shown = path.display().to_string();
    if !path.is_absolute() {
        return Err(FsError::OutsideWorkspace(shown));
    }
    if !path.exists() {
        return fs::create_dir_all(path).map_err(|e| FsError::io(&shown, e));
    }
    if !path.is_dir() {
        return Err(FsError::AlreadyExists(shown));
    }
    let empty = fs::read_dir(path)
        .map_err(|e| FsError::io(&shown, e))?
        .next()
        .is_none();
    if empty || path.join(".knyc").join("project.json").is_file() {
        Ok(())
    } else {
        Err(FsError::AlreadyExists(format!(
            "{shown} already holds other files; choose an empty folder"
        )))
    }
}

/// Creates (or reuses) the learner's workspace folder and opens it.
#[tauri::command]
pub fn workspace_create(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    root: String,
) -> FsResult<WorkspaceInfo> {
    let path = PathBuf::from(root);
    prepare_workspace_folder(&path)?;
    open_folder(&app, &state, path)
}

/// Saves the learner's code in `.knyc/snapshots.git` (#65); returns the commit.
#[tauri::command]
pub async fn workspace_snapshot(
    state: State<'_, WorkspaceState>,
    message: String,
) -> FsResult<String> {
    let root = state.scope()?.root().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || snapshots::snapshot(&root, &message))
        .await
        .map_err(|e| FsError::Io(e.to_string()))?
        .map_err(FsError::Io)
}

/// Whether a path exists in the open folder, including ones the tree hides (`node_modules`).
#[tauri::command]
pub fn workspace_exists(state: State<'_, WorkspaceState>, path: String) -> FsResult<bool> {
    Ok(state.scope()?.resolve(&path)?.exists())
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileForAi {
    pub path: String,
    /// None when the file is missing, a secret by name, binary or too large.
    pub content: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForAi {
    pub files: Vec<FileForAi>,
    pub texts: Vec<String>,
}

/// The learner's files and other text (check output) as they may go to the AI (#63, #64): the
/// analysis's secret guard, in Rust like the scan — secret files never leave, secret-looking
/// lines are replaced.
fn for_ai(scope: &Scope, paths: Vec<String>, texts: Vec<String>) -> FsResult<ForAi> {
    let mut files = Vec::with_capacity(paths.len());
    for path in paths {
        let name = path.rsplit('/').next().unwrap_or(&path);
        let content = if is_secret_file(name) {
            None
        } else {
            match scope.read_text(&path) {
                Ok(text) => Some(redact_secrets(&text)),
                Err(FsError::NotFound(_) | FsError::NotText(_) | FsError::TooLarge(_)) => None,
                Err(e) => return Err(e),
            }
        };
        files.push(FileForAi { path, content });
    }
    Ok(ForAi {
        files,
        texts: texts.iter().map(|t| redact_secrets(t)).collect(),
    })
}

#[tauri::command]
pub fn workspace_read_for_ai(
    state: State<'_, WorkspaceState>,
    paths: Vec<String>,
    texts: Vec<String>,
) -> FsResult<ForAi> {
    for_ai(&state.scope()?, paths, texts)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRunRequest {
    command: String,
    /// Package folder, relative to the workspace.
    root: String,
    timeout_ms: u64,
    #[serde(default)]
    env: BTreeMap<String, String>,
    /// Jest/Vitest JSON report the command writes, relative to `root`.
    report: Option<String>,
    /// Docker mode (#91): the toolchain image to run the command in, the workspace mounted.
    docker_image: Option<String>,
}

/// The container a check runs in, in Docker mode: the image, the open workspace mounted.
fn container_for(
    scope: &Scope,
    image: Option<String>,
) -> Option<knyc_runner::container::Container> {
    image.map(|image| knyc_runner::container::Container {
        image,
        mount: scope.root().to_path_buf(),
    })
}

/// Runs one check command in the open workspace (#62): same runner as the pipeline (timeout,
/// process-tree kill, test report), but only inside the folder the learner opened.
#[tauri::command]
pub async fn workspace_check_run(
    state: State<'_, WorkspaceState>,
    request: CheckRunRequest,
) -> FsResult<CheckOutcome> {
    let scope = state.scope()?;
    let cwd = scope.resolve(&request.root)?;
    if let Some(report) = &request.report {
        // Resolved only to refuse a report path outside the workspace.
        scope.resolve(&format!("{}/{report}", request.root))?;
    }
    let mut spec = RunSpec::new(request.command, cwd);
    spec.timeout = Duration::from_millis(request.timeout_ms);
    spec.env = request.env;
    spec.container = container_for(&scope, request.docker_image);
    tauri::async_runtime::spawn_blocking(move || {
        run_check(&spec, request.report.map(PathBuf::from))
    })
    .await
    .map_err(|e| FsError::Io(e.to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerCheckRequest {
    timeout_ms: u64,
    spec: knyc_runner::docker::DockerSpec,
}

/// Runs a Docker check in the open workspace (#90): build (and run) the image, then remove what
/// the check made. The build context and the Dockerfile must be inside the workspace.
#[tauri::command]
pub async fn workspace_docker_check(
    state: State<'_, WorkspaceState>,
    request: DockerCheckRequest,
) -> FsResult<knyc_runner::docker::DockerCheckOutcome> {
    let scope = state.scope()?;
    scope.resolve(&request.spec.context)?;
    scope.resolve(&request.spec.dockerfile)?;
    let cwd = scope.root().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        knyc_runner::docker::run_docker_check(
            &request.spec,
            &cwd,
            Duration::from_millis(request.timeout_ms),
        )
    })
    .await
    .map_err(|e| FsError::Io(e.to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpCheckRequest {
    /// Package folder that starts the server, relative to the workspace.
    root: String,
    timeout_ms: u64,
    server: knyc_runner::http::ServerSpec,
    requests: Vec<knyc_runner::http::HttpRequestSpec>,
    /// Docker mode (#91): the server runs in this image, the workspace mounted.
    docker_image: Option<String>,
}

/// Runs an HTTP check in the open workspace (#88): the server starts in its package, answers the
/// requests, and is stopped with everything it started.
#[tauri::command]
pub async fn workspace_http_check(
    state: State<'_, WorkspaceState>,
    request: HttpCheckRequest,
) -> FsResult<knyc_runner::http::HttpCheckOutcome> {
    let scope = state.scope()?;
    let cwd = scope.resolve(&request.root)?;
    let container = container_for(&scope, request.docker_image);
    tauri::async_runtime::spawn_blocking(move || {
        knyc_runner::http::run_http_check_in(
            &request.server,
            &request.requests,
            &cwd,
            Duration::from_millis(request.timeout_ms),
            container.as_ref(),
        )
    })
    .await
    .map_err(|e| FsError::Io(e.to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiCheckRequest {
    /// Package folder that starts the frontend, relative to the workspace.
    root: String,
    timeout_ms: u64,
    server: knyc_runner::http::ServerSpec,
    /// The UI test modules, relative to the workspace.
    files: Vec<String>,
    /// Servers started first, each in its package (the original backend, #92).
    #[serde(default)]
    companions: Vec<CompanionRequest>,
    /// Docker mode (#91): the frontend runs in this image; Chromium stays on this computer.
    docker_image: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionRequest {
    #[serde(flatten)]
    server: knyc_runner::http::ServerSpec,
    /// Package folder, relative to the workspace.
    root: String,
}

/// Runs a UI check in the open workspace (#89): the frontend starts in its package, the tests run
/// in KnYC's Chromium, and the server is stopped with everything it started.
#[tauri::command]
pub async fn workspace_ui_check(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    request: UiCheckRequest,
) -> FsResult<knyc_runner::ui::UiCheckOutcome> {
    let scope = state.scope()?;
    let cwd = scope.resolve(&request.root)?;
    let tests = request
        .files
        .iter()
        .map(|f| scope.resolve(f))
        .collect::<Result<Vec<_>, _>>()?;
    let companions = request
        .companions
        .into_iter()
        .map(|c| {
            Ok(knyc_runner::ui::Companion {
                cwd: scope.resolve(&c.root)?,
                server: c.server,
            })
        })
        .collect::<FsResult<Vec<_>>>()?;
    let container = container_for(&scope, request.docker_image);
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| FsError::Io(e.to_string()))?;
    let runner = crate::browser::ui_runner(&data).map_err(FsError::Io)?;
    tauri::async_runtime::spawn_blocking(move || {
        knyc_runner::ui::run_ui_check_with(
            &request.server,
            &companions,
            &tests,
            &cwd,
            &runner,
            Duration::from_millis(request.timeout_ms),
            container.as_ref(),
        )
    })
    .await
    .map_err(|e| FsError::Io(e.to_string()))
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
    use knyc_analyzer::secrets::REDACTED;

    #[test]
    fn commands_need_an_open_folder() {
        let state = WorkspaceState::default();
        assert!(matches!(state.scope(), Err(FsError::NoWorkspace(_))));
    }

    #[test]
    fn a_workspace_folder_is_new_empty_or_already_knyc() {
        let dir = tempfile::tempdir().unwrap();
        let new = dir.path().join("KnYC/notes");
        prepare_workspace_folder(&new).unwrap();
        assert!(new.is_dir());
        // Empty: fine again.
        prepare_workspace_folder(&new).unwrap();

        let project = dir.path().join("my-project");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("app.ts"), "").unwrap();
        assert!(matches!(
            prepare_workspace_folder(&project),
            Err(FsError::AlreadyExists(_))
        ));

        std::fs::create_dir_all(new.join(".knyc")).unwrap();
        std::fs::write(new.join(".knyc/project.json"), "{}").unwrap();
        std::fs::write(new.join("package.json"), "{}").unwrap();
        prepare_workspace_folder(&new).unwrap();

        assert!(matches!(
            prepare_workspace_folder(Path::new("relative/folder")),
            Err(FsError::OutsideWorkspace(_))
        ));
    }

    #[test]
    fn files_for_ai_keep_secrets_out() {
        let dir = tempfile::tempdir().unwrap();
        let scope = Scope::new(dir.path()).unwrap();
        scope.write_text(".env", "TOKEN=abc\n").unwrap();
        scope
            .write_text(
                "config.ts",
                "export const port = 3000;\nexport const db = \"postgres://admin:hunter22@db:5432/app\";\n",
            )
            .unwrap();
        let out = for_ai(
            &scope,
            vec![".env".into(), "config.ts".into(), "missing.ts".into()],
            vec!["Error: connect postgres://admin:hunter22@db:5432/app refused".into()],
        )
        .unwrap();
        assert_eq!(out.files[0].content, None);
        assert_eq!(
            out.files[1].content.as_deref(),
            Some(format!("export const port = 3000;\n{REDACTED}\n").as_str())
        );
        assert_eq!(out.files[2].content, None);
        assert_eq!(out.texts, vec![REDACTED.to_string()]);
        assert!(matches!(
            for_ai(&scope, vec!["../outside.ts".into()], vec![]),
            Err(FsError::OutsideWorkspace(_))
        ));
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
