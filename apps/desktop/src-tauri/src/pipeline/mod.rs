//! The pipeline host for the app (#55, design/06 H3): the TypeScript pipeline from `@knyc/core`
//! runs in the page and reaches the system through these commands, the counterpart of the CLI's
//! `NodeHost`. The knyc-sys steps call knyc-analyzer and knyc-runner as libraries, exactly like the
//! knyc-sys binary does. Every path goes through [`PipelineScope`].

mod scope;

pub use scope::{PipelineScope, ScopeError, check_git_args};

use knyc_analyzer::{graph, intake, scan};
use knyc_runner::check::run_check;
use knyc_runner::run::RunSpec;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// A knyc-sys step, as `SysRequest` in packages/core/src/host/host.ts.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SysRequest {
    Intake {
        source: String,
        sandbox: String,
    },
    Scan {
        folder: String,
        toolchains: bool,
    },
    Graph {
        folder: String,
    },
    Run {
        cwd: String,
        command: String,
        timeout_ms: u64,
        #[serde(default)]
        env: BTreeMap<String, String>,
        report: Option<String>,
    },
    /// A Docker check on a sandboxed project (#90).
    Docker {
        cwd: String,
        timeout_ms: u64,
        spec: knyc_runner::docker::DockerSpec,
    },
    /// An HTTP check against the server of a sandboxed project (#88).
    Http {
        cwd: String,
        timeout_ms: u64,
        server: knyc_runner::http::ServerSpec,
        requests: Vec<knyc_runner::http::HttpRequestSpec>,
    },
    /// UI tests in Chromium against the frontend of a sandboxed project (#89). Chromium is the
    /// app's own (`browsers` from the page is ignored).
    Ui {
        cwd: String,
        timeout_ms: u64,
        server: knyc_runner::http::ServerSpec,
        tests: Vec<String>,
        /// Servers started first (the original backend, #92), each in its sandbox folder.
        #[serde(default)]
        companions: Vec<knyc_runner::ui::Companion>,
        #[allow(dead_code)]
        browsers: Option<String>,
    },
    /// Chromium for the UI checks (#89): status or size; the download goes through
    /// `browser_install`, after the learner agreed.
    Browser {
        action: String,
        #[allow(dead_code)]
        browsers: Option<String>,
    },
}

fn io_error(path: &Path, error: std::io::Error) -> String {
    format!("{}: {error}", path.display())
}

pub fn read_file(scope: &PipelineScope, path: &str) -> Result<String, String> {
    let real = scope.readable(path).map_err(|e| e.to_string())?;
    fs::read_to_string(&real).map_err(|e| io_error(&real, e))
}

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Temp file next to the target, then rename: a crash never leaves half a file (the AI cache
/// relies on it).
pub fn write_file(scope: &PipelineScope, path: &str, content: &str) -> Result<(), String> {
    let real = scope.writable(path).map_err(|e| e.to_string())?;
    if let Some(parent) = real.parent() {
        fs::create_dir_all(parent).map_err(|e| io_error(parent, e))?;
    }
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut tmp = real.clone().into_os_string();
    tmp.push(format!(".{}.{n}.tmp", std::process::id()));
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, content).map_err(|e| io_error(&tmp, e))?;
    fs::rename(&tmp, &real).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        io_error(&real, e)
    })
}

pub fn append_file(scope: &PipelineScope, path: &str, content: &str) -> Result<(), String> {
    let real = scope.writable(path).map_err(|e| e.to_string())?;
    if let Some(parent) = real.parent() {
        fs::create_dir_all(parent).map_err(|e| io_error(parent, e))?;
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&real)
        .and_then(|mut file| file.write_all(content.as_bytes()))
        .map_err(|e| io_error(&real, e))
}

pub fn copy_file(scope: &PipelineScope, from: &str, to: &str) -> Result<(), String> {
    let source = scope.readable(from).map_err(|e| e.to_string())?;
    let target = scope.writable(to).map_err(|e| e.to_string())?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| io_error(parent, e))?;
    }
    fs::copy(&source, &target)
        .map(|_| ())
        .map_err(|e| io_error(&source, e))
}

/// A file or a whole folder; nothing happens when it doesn't exist. Never the data folder itself.
pub fn remove(scope: &PipelineScope, path: &str) -> Result<(), String> {
    let real = scope.writable(path).map_err(|e| e.to_string())?;
    if real == scope.data_dir() {
        return Err("the pipeline cannot remove the KnYC data folder".into());
    }
    let result = match fs::symlink_metadata(&real) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => Err(e),
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(&real),
        Ok(_) => fs::remove_file(&real),
    };
    result.map_err(|e| io_error(&real, e))
}

/// Hides the console window git would otherwise flash on Windows (the app is a GUI program).
fn no_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

/// Runs git (no shell) in a folder of the data folder; resolves to its trimmed stdout.
pub fn git(scope: &PipelineScope, cwd: &str, args: &[String]) -> Result<String, String> {
    check_git_args(args)?;
    let cwd = scope.writable(cwd).map_err(|e| e.to_string())?;
    let output = no_window(Command::new("git").args(args).current_dir(&cwd))
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("could not start git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "git {} failed: {}",
            args.first().map(String::as_str).unwrap_or(""),
            stderr.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// A knyc-sys step, with the same JSON result as the knyc-sys binary.
pub fn sys(scope: &PipelineScope, request: SysRequest) -> Result<serde_json::Value, String> {
    let json =
        |value: Result<serde_json::Value, serde_json::Error>| value.map_err(|e| e.to_string());
    let scoped = |result: Result<PathBuf, ScopeError>| result.map_err(|e| e.to_string());
    let failed = |op: &str, e: anyhow::Error| format!("knyc-sys {op} failed: {e:#}");
    match request {
        SysRequest::Intake { source, sandbox } => {
            let source = scoped(scope.readable(&source))?;
            let sandbox = scoped(scope.writable(&sandbox))?;
            let report = intake::intake(&source, &sandbox).map_err(|e| failed("intake", e))?;
            json(serde_json::to_value(report))
        }
        SysRequest::Scan { folder, toolchains } => {
            let folder = scoped(scope.readable(&folder))?;
            let options = scan::ScanOptions {
                detect_toolchains: toolchains,
            };
            let scanned = scan::scan(&folder, options).map_err(|e| failed("scan", e))?;
            json(serde_json::to_value(scanned))
        }
        SysRequest::Graph { folder } => {
            let folder = scoped(scope.readable(&folder))?;
            let built = graph::build(&folder).map_err(|e| failed("graph", e))?;
            json(serde_json::to_value(built))
        }
        SysRequest::Run {
            cwd,
            command,
            timeout_ms,
            env,
            report,
        } => {
            // Builds and checks of the learner's project run in its sandbox, never in the source.
            let cwd = scoped(scope.writable(&cwd))?;
            let mut spec = RunSpec::new(command, cwd);
            spec.timeout = Duration::from_millis(timeout_ms);
            spec.env = env;
            json(serde_json::to_value(run_check(
                &spec,
                report.map(PathBuf::from),
            )))
        }
        SysRequest::Docker {
            cwd,
            timeout_ms,
            spec,
        } => {
            let cwd = scoped(scope.writable(&cwd))?;
            json(serde_json::to_value(knyc_runner::docker::run_docker_check(
                &spec,
                &cwd,
                Duration::from_millis(timeout_ms),
            )))
        }
        SysRequest::Http {
            cwd,
            timeout_ms,
            server,
            requests,
        } => {
            let cwd = scoped(scope.writable(&cwd))?;
            json(serde_json::to_value(knyc_runner::http::run_http_check(
                &server,
                &requests,
                &cwd,
                Duration::from_millis(timeout_ms),
            )))
        }
        SysRequest::Ui {
            cwd,
            timeout_ms,
            server,
            tests,
            companions,
            browsers: _,
        } => {
            let cwd = scoped(scope.writable(&cwd))?;
            let tests = tests
                .iter()
                .map(|t| scoped(scope.writable(t)))
                .collect::<Result<Vec<_>, _>>()?;
            let companions = companions
                .into_iter()
                .map(|c| {
                    let cwd = scoped(scope.writable(&c.cwd.to_string_lossy()))?;
                    Ok(knyc_runner::ui::Companion { cwd, ..c })
                })
                .collect::<Result<Vec<_>, String>>()?;
            let runner = crate::browser::ui_runner(scope.data())?;
            json(serde_json::to_value(knyc_runner::ui::run_ui_check_with(
                &server,
                &companions,
                &tests,
                &cwd,
                &runner,
                Duration::from_millis(timeout_ms),
                None,
            )))
        }
        SysRequest::Browser {
            action,
            browsers: _,
        } => {
            if action != "status" && action != "size" {
                return Err(format!("knyc-sys browser {action} isn't allowed here"));
            }
            let runner = crate::browser::ui_runner(scope.data())?;
            knyc_runner::ui::browser(&runner, &action).map_err(|e| failed("browser", e))
        }
    }
}

/// The scope, created on first use under the app's data folder.
#[derive(Default)]
pub struct PipelineState(Mutex<Option<PipelineScope>>);

impl PipelineState {
    fn with<T>(
        &self,
        app: &AppHandle,
        f: impl FnOnce(&mut PipelineScope) -> T,
    ) -> Result<T, String> {
        let mut guard = self.0.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
            *guard = Some(PipelineScope::new(&data).map_err(|e| io_error(&data, e))?);
        }
        Ok(f(guard.as_mut().expect("just set")))
    }

    fn scope(&self, app: &AppHandle) -> Result<PipelineScope, String> {
        self.with(app, |scope| scope.clone())
    }
}

/// Runs the operation off the main thread (git, scans and builds take seconds or minutes).
async fn blocking<T: Send + 'static>(
    app: &AppHandle,
    state: &PipelineState,
    work: impl FnOnce(PipelineScope) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let scope = state.scope(app)?;
    tauri::async_runtime::spawn_blocking(move || work(scope))
        .await
        .map_err(|e| e.to_string())?
}

/// The folder the pipeline writes in (sandboxes, timelines, caches).
#[tauri::command]
pub fn pipeline_data_dir(
    app: AppHandle,
    state: State<'_, PipelineState>,
) -> Result<String, String> {
    state.with(&app, |scope| scope.data_dir().display().to_string())
}

/// Shows the folder dialog for a project to import; the picked folder becomes readable for the
/// pipeline. None when the learner cancels. The dialog runs in Rust, so the page can't grant
/// itself access to an arbitrary folder.
#[tauri::command]
pub async fn pipeline_pick_source(
    app: AppHandle,
    state: State<'_, PipelineState>,
) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let real = state
        .with(&app, |scope| scope.add_source(&path))?
        .map_err(|e| e.to_string())?;
    Ok(Some(real.display().to_string()))
}

/// Shows the folder dialog for where the learner will rebuild the project (import screen). Only
/// the path comes back: picking it grants the pipeline nothing.
#[tauri::command]
pub async fn pipeline_choose_folder(app: AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub async fn host_read_file(
    app: AppHandle,
    state: State<'_, PipelineState>,
    path: String,
) -> Result<String, String> {
    blocking(&app, &state, move |scope| read_file(&scope, &path)).await
}

#[tauri::command]
pub async fn host_write_file(
    app: AppHandle,
    state: State<'_, PipelineState>,
    path: String,
    content: String,
) -> Result<(), String> {
    blocking(&app, &state, move |scope| {
        write_file(&scope, &path, &content)
    })
    .await
}

#[tauri::command]
pub async fn host_append_file(
    app: AppHandle,
    state: State<'_, PipelineState>,
    path: String,
    content: String,
) -> Result<(), String> {
    blocking(&app, &state, move |scope| {
        append_file(&scope, &path, &content)
    })
    .await
}

#[tauri::command]
pub async fn host_copy_file(
    app: AppHandle,
    state: State<'_, PipelineState>,
    from: String,
    to: String,
) -> Result<(), String> {
    blocking(&app, &state, move |scope| copy_file(&scope, &from, &to)).await
}

#[tauri::command]
pub async fn host_remove(
    app: AppHandle,
    state: State<'_, PipelineState>,
    path: String,
) -> Result<(), String> {
    blocking(&app, &state, move |scope| remove(&scope, &path)).await
}

#[tauri::command]
pub async fn host_git(
    app: AppHandle,
    state: State<'_, PipelineState>,
    cwd: String,
    args: Vec<String>,
) -> Result<String, String> {
    blocking(&app, &state, move |scope| git(&scope, &cwd, &args)).await
}

#[tauri::command]
pub async fn host_sys(
    app: AppHandle,
    state: State<'_, PipelineState>,
    request: SysRequest,
) -> Result<serde_json::Value, String> {
    blocking(&app, &state, move |scope| sys(&scope, request)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PipelineScope, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("notes");
        fs::create_dir_all(source.join("src")).unwrap();
        fs::write(
            source.join("package.json"),
            r#"{"name":"notes","scripts":{"build":"node -e \"\"","test":"node -e \"\""}}"#,
        )
        .unwrap();
        fs::write(
            source.join("src/app.js"),
            "import { store } from './store.js';\nexport const app = store;\n",
        )
        .unwrap();
        fs::write(
            source.join("src/store.js"),
            "export const store = new Map();\n",
        )
        .unwrap();
        fs::write(source.join(".env"), "TOKEN=secret\n").unwrap();
        let mut scope = PipelineScope::new(&dir.path().join("data")).unwrap();
        scope.add_source(&source).unwrap();
        (dir, scope, source)
    }

    fn at(base: &Path, rel: &str) -> String {
        format!("{}/{rel}", base.display())
    }

    #[test]
    fn files_round_trip_atomically_inside_the_data_folder() {
        let (_dir, scope, source) = setup();
        let data = scope.data_dir().to_path_buf();
        let file = at(&data, "cache/ai/key.json");
        write_file(&scope, &file, "{\"a\":1}").unwrap();
        write_file(&scope, &file, "{\"a\":2}").unwrap();
        assert_eq!(read_file(&scope, &file).unwrap(), "{\"a\":2}");
        let leftovers: Vec<_> = fs::read_dir(data.join("cache/ai"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(leftovers.len(), 1, "temp files left behind: {leftovers:?}");

        append_file(
            &scope,
            &at(&data, "work/.git/info/exclude"),
            "node_modules/\n",
        )
        .unwrap();
        append_file(&scope, &at(&data, "work/.git/info/exclude"), "dist/\n").unwrap();
        assert_eq!(
            read_file(&scope, &at(&data, "work/.git/info/exclude")).unwrap(),
            "node_modules/\ndist/\n"
        );

        copy_file(
            &scope,
            &at(&source, "src/app.js"),
            &at(&data, "work/src/app.js"),
        )
        .unwrap();
        assert!(
            read_file(&scope, &at(&data, "work/src/app.js"))
                .unwrap()
                .contains("export const app")
        );

        remove(&scope, &at(&data, "work")).unwrap();
        remove(&scope, &at(&data, "work")).unwrap(); // already gone: fine
        assert!(read_file(&scope, &at(&data, "work/src/app.js")).is_err());
    }

    #[test]
    fn refuses_writes_outside_and_the_data_folder_itself() {
        let (dir, scope, source) = setup();
        assert!(write_file(&scope, &at(&source, "src/app.js"), "x").is_err());
        assert_eq!(
            fs::read_to_string(source.join("src/app.js"))
                .unwrap()
                .lines()
                .count(),
            2
        );
        assert!(write_file(&scope, &at(dir.path(), "elsewhere.txt"), "x").is_err());
        assert!(!dir.path().join("elsewhere.txt").exists());
        assert!(
            copy_file(
                &scope,
                &at(&source, "src/app.js"),
                &at(&source, "src/copy.js")
            )
            .is_err()
        );
        assert!(remove(&scope, &at(&source, "src")).is_err());
        assert!(source.join("src").exists());
        assert!(remove(&scope, &scope.data_dir().display().to_string()).is_err());
        assert!(read_file(&scope, &at(dir.path(), "notes-other/x")).is_err());
    }

    #[test]
    fn git_runs_in_the_data_folder_only() {
        let (_dir, scope, source) = setup();
        let work = at(scope.data_dir(), "timeline/notes");
        fs::create_dir_all(scope.data_dir().join("timeline/notes")).unwrap();
        let run = |args: &[&str]| {
            git(
                &scope,
                &work,
                &args.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
            )
        };
        run(&["init", "-q"]).unwrap();
        run(&["config", "user.name", "KnYC"]).unwrap();
        run(&["config", "user.email", "knyc@localhost"]).unwrap();
        write_file(&scope, &format!("{work}/a.txt"), "one\n").unwrap();
        run(&["add", "-A"]).unwrap();
        run(&["commit", "-q", "-m", "s01"]).unwrap();
        run(&["tag", "-f", "p/s01"]).unwrap();
        assert_eq!(run(&["show", "p/s01:a.txt"]).unwrap(), "one");
        assert!(
            run(&["checkout", "-q", "does-not-exist"])
                .unwrap_err()
                .starts_with("git checkout failed")
        );
        assert!(run(&["config", "core.hooksPath", "x"]).is_err());
        assert!(git(&scope, &at(&source, ""), &["init".to_string()]).is_err());
        assert!(!source.join(".git").exists());
    }

    #[test]
    fn sys_steps_match_knyc_sys() {
        let (_dir, scope, source) = setup();
        let sandbox = at(scope.data_dir(), "sandboxes/notes");
        let request = |json: serde_json::Value| serde_json::from_value::<SysRequest>(json).unwrap();

        let intake = sys(
            &scope,
            request(serde_json::json!({ "op": "intake", "source": source, "sandbox": sandbox })),
        )
        .unwrap();
        assert!(intake["filesCopied"].as_u64().unwrap_or(0) >= 3, "{intake}");
        assert!(
            !scope.data_dir().join("sandboxes/notes/.env").exists(),
            "secrets must stay out of the sandbox"
        );

        let scanned = sys(
            &scope,
            request(serde_json::json!({ "op": "scan", "folder": sandbox, "toolchains": false })),
        )
        .unwrap();
        assert_eq!(scanned["commands"][0]["test"], "npm run test");
        let graph = sys(
            &scope,
            request(serde_json::json!({ "op": "graph", "folder": source })),
        )
        .unwrap();
        assert!(
            graph["files"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f["path"] == "src/app.js")
        );

        let ran = sys(
            &scope,
            request(serde_json::json!({ "op": "run", "cwd": sandbox, "command": "node -e \"console.log('hi')\"", "timeoutMs": 30000, "env": {} })),
        )
        .unwrap();
        assert_eq!(ran["status"], "pass", "{ran}");

        // Builds never run in the learner's own folder.
        let refused = sys(
            &scope,
            request(
                serde_json::json!({ "op": "run", "cwd": source, "command": "node -v", "timeoutMs": 30000 }),
            ),
        );
        assert!(refused.unwrap_err().contains("outside"));
        let refused = sys(
            &scope,
            request(
                serde_json::json!({ "op": "intake", "source": source, "sandbox": source.join("copy") }),
            ),
        );
        assert!(refused.is_err());
    }
}
