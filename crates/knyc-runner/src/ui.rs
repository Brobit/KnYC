//! UI checks (#89, design/06 H4): start the project's frontend server like an HTTP check, then run
//! the step's UI tests in headless Chromium through KnYC's runner (`packages/ui-runner/run.mjs`,
//! with its own playwright-core, on the learner's Node.js). Nothing is added to the learner's
//! project; Chromium lives in KnYC's data folder (`PLAYWRIGHT_BROWSERS_PATH`).

use crate::container::Container;
use crate::http::{HttpStatus, ServerSpec, serve};
use crate::run::{RunSpec, run};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_OUTPUT: usize = 16 * 1024;

/// KnYC's UI runner and the folder Chromium is downloaded into.
#[derive(Debug, Clone)]
pub struct UiRunner {
    /// `run.mjs`, next to its node_modules.
    pub script: PathBuf,
    pub browsers: PathBuf,
}

impl UiRunner {
    fn spec(&self, args: &[&str], timeout: Duration) -> RunSpec {
        let quoted = |s: &str| format!("\"{s}\"");
        let mut command = vec!["node".to_string(), quoted(&self.script.to_string_lossy())];
        command.extend(args.iter().map(|a| quoted(a)));
        let mut spec = RunSpec::new(
            command.join(" "),
            self.script.parent().unwrap_or(Path::new(".")),
        );
        spec.timeout = timeout;
        spec.env = BTreeMap::from([(
            "PLAYWRIGHT_BROWSERS_PATH".to_string(),
            self.browsers.to_string_lossy().into_owned(),
        )]);
        spec
    }
}

/// The runner: `KNYC_UI_RUNNER`, else `ui-runner/run.mjs` in `resources` (the app's), else
/// `packages/ui-runner/run.mjs` above `near` (a checkout of the repo, in development).
pub fn find_runner(resources: Option<&Path>, near: &Path) -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("KNYC_UI_RUNNER") {
        return Some(PathBuf::from(path));
    }
    if let Some(found) = resources
        .map(|r| r.join("ui-runner").join("run.mjs"))
        .filter(|p| p.is_file())
    {
        return Some(found);
    }
    near.ancestors()
        .map(|dir| dir.join("packages").join("ui-runner").join("run.mjs"))
        .find(|p| p.is_file())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UiStatus {
    Pass,
    Fail,
    Timeout,
    Error,
    /// Chromium isn't downloaded, or Node.js is missing.
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UiTestResult {
    pub file: String,
    pub status: String,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub page_errors: Vec<String>,
    /// The page's accessibility tree when the test failed (text for "Explain this failure").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<String>,
    /// A JPEG of the page when the test failed, base64.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiCheckOutcome {
    pub status: UiStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub tests: Vec<UiTestResult>,
    /// What the server printed, then what the tests printed.
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub duration_ms: u64,
}

/// What the runner writes.
#[derive(Deserialize)]
struct RunnerOutcome {
    status: UiStatus,
    #[serde(default)]
    tests: Vec<UiTestResult>,
    error: Option<String>,
}

fn cut(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &text[start..])
}

/// Runs `tests` (absolute paths of ES modules in the workspace) against the server started in
/// `cwd`. In Docker mode the server runs in the container and Chromium on this computer.
/// A server started before the frontend (the original backend its dev proxy calls, #92), in its
/// package folder.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Companion {
    #[serde(flatten)]
    pub server: ServerSpec,
    /// Its package folder, absolute.
    pub cwd: PathBuf,
}

/// Starts each companion in turn, runs `with` while they all answer, then stops them.
fn with_companions<T>(
    companions: &[Companion],
    timeout: Duration,
    container: Option<&Container>,
    output: &Arc<Mutex<String>>,
    with: impl FnOnce() -> T,
) -> Result<T, (HttpStatus, String)> {
    match companions.split_first() {
        None => Ok(with()),
        Some((first, rest)) => serve(
            &first.server,
            &first.cwd,
            timeout,
            container,
            output,
            |_| with_companions(rest, timeout, container, output, with),
        )
        .and_then(|(_, inner)| inner)
        .map_err(|(status, error)| {
            (
                status,
                format!("{} (needed by the frontend): {error}", first.server.start),
            )
        }),
    }
}

pub fn run_ui_check(
    server: &ServerSpec,
    tests: &[PathBuf],
    cwd: &Path,
    runner: &UiRunner,
    timeout: Duration,
    container: Option<&Container>,
) -> UiCheckOutcome {
    run_ui_check_with(server, &[], tests, cwd, runner, timeout, container)
}

/// Like [`run_ui_check`], with `companions` started first (the frontend's backend, #92).
pub fn run_ui_check_with(
    server: &ServerSpec,
    companions: &[Companion],
    tests: &[PathBuf],
    cwd: &Path,
    runner: &UiRunner,
    timeout: Duration,
    container: Option<&Container>,
) -> UiCheckOutcome {
    let started = Instant::now();
    let output = Arc::new(Mutex::new(String::new()));
    let printed = Mutex::new(String::new());
    let test = |served: &crate::http::Served| -> Result<RunnerOutcome, (UiStatus, String)> {
        let out = tempfile::Builder::new()
            .prefix("knyc-ui-")
            .suffix(".json")
            .tempfile()
            .map_err(|e| (UiStatus::Error, format!("no temporary file: {e}")))?;
        let spec_file = tempfile::Builder::new()
            .prefix("knyc-ui-spec-")
            .suffix(".json")
            .tempfile()
            .map_err(|e| (UiStatus::Error, format!("no temporary file: {e}")))?;
        let left = timeout.saturating_sub(started.elapsed());
        let spec = serde_json::json!({
            "baseUrl": format!("http://localhost:{}", served.port),
            "tests": tests,
            // Mount pages are served from the frontend's folder (#92).
            "root": cwd,
            "timeoutMs": left.as_millis() as u64,
            "out": out.path(),
        });
        std::fs::write(spec_file.path(), spec.to_string())
            .map_err(|e| (UiStatus::Error, e.to_string()))?;
        let spec_path = spec_file.path().to_string_lossy().into_owned();
        // Room for Chromium to start and close around the tests' own time limit.
        let result = run(&runner.spec(&["test", &spec_path], left + Duration::from_secs(30)))
            .map_err(|e| {
                (
                    UiStatus::Unavailable,
                    format!("UI checks need Node.js: {e:#}"),
                )
            })?;
        if let Ok(mut p) = printed.lock() {
            *p = format!("{}{}", result.stdout, result.stderr);
        }
        if result.timed_out {
            return Err((
                UiStatus::Timeout,
                format!("the UI tests didn't finish within {} s", left.as_secs()),
            ));
        }
        let written = std::fs::read_to_string(out.path()).unwrap_or_default();
        serde_json::from_str::<RunnerOutcome>(&written).map_err(|_| {
            let said = format!("{}{}", result.stdout, result.stderr);
            let missing = said.contains("Cannot find module") || result.exit_code == Some(9009);
            (
                if missing {
                    UiStatus::Unavailable
                } else {
                    UiStatus::Error
                },
                format!("the UI runner failed: {}", cut(said.trim(), 2000)),
            )
        })
    };
    let served = with_companions(companions, timeout, container, &output, || {
        serve(server, cwd, timeout, container, &output, test)
    })
    .and_then(|inner| inner);
    let all_output = || {
        let server_output = output.lock().map(|o| o.clone()).unwrap_or_default();
        let tests_output = printed.lock().map(|p| p.clone()).unwrap_or_default();
        cut(
            &[server_output, tests_output]
                .into_iter()
                .filter(|s| !s.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
            MAX_OUTPUT,
        )
    };
    let done = |status, port, tests, error| UiCheckOutcome {
        status,
        port,
        tests,
        output: all_output(),
        error,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    match served {
        Ok((served, Ok(outcome))) => done(
            outcome.status,
            Some(served.port),
            outcome.tests,
            outcome.error.or(served.note),
        ),
        Ok((served, Err((status, error)))) => done(status, Some(served.port), vec![], Some(error)),
        Err((status, error)) => done(
            match status {
                HttpStatus::Timeout => UiStatus::Timeout,
                _ => UiStatus::Error,
            },
            None,
            vec![],
            Some(error),
        ),
    }
}

/// Chromium for the UI checks: "status", "size" (bytes to download) or "install". The runner's
/// JSON answer.
pub fn browser(runner: &UiRunner, action: &str) -> anyhow::Result<serde_json::Value> {
    let timeout = if action == "install" {
        Duration::from_secs(30 * 60)
    } else {
        Duration::from_secs(60)
    };
    let result = run(&runner.spec(&[action], timeout))?;
    let line = result
        .stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| {
            anyhow::anyhow!(
                "the UI runner said nothing: {}",
                cut(result.stderr.trim(), 2000)
            )
        })?;
    Ok(serde_json::from_str(line)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_runner_in_the_apps_resources_or_the_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo_runner = dir.path().join("packages/ui-runner/run.mjs");
        std::fs::create_dir_all(repo_runner.parent().unwrap()).unwrap();
        std::fs::write(&repo_runner, "").unwrap();
        let deep = dir.path().join("target/release");
        std::fs::create_dir_all(&deep).unwrap();
        assert_eq!(find_runner(None, &deep), Some(repo_runner));

        let resources = dir.path().join("resources");
        std::fs::create_dir_all(resources.join("ui-runner")).unwrap();
        std::fs::write(resources.join("ui-runner/run.mjs"), "").unwrap();
        assert_eq!(
            find_runner(Some(&resources), &deep),
            Some(resources.join("ui-runner/run.mjs"))
        );
    }
}
