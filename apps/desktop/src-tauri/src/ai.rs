//! Claude Code calls for the pipeline in the app (#56; design/06 H3: the CLI is the only provider in
//! the alpha). The page sends data only (model, system prompt, prompt, JSON schema): the command
//! line is built here, so the call is always answer-only (`--tools ""`), never saved as a session,
//! and run in an empty folder so no project instructions (CLAUDE.md) leak in. The output is read
//! by `interpretClaudeRun` in @knyc/core, shared with the CLI's provider.

use crate::providers::locate_claude;
use knyc_runner::run::{RunSpec, run_program};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// Answers larger than this are refused (a full learning-path plan is a few hundred KB).
const MAX_OUTPUT: usize = 32 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCall {
    pub model: String,
    pub system: String,
    /// Sent on stdin.
    pub prompt: String,
    pub json_schema: serde_json::Map<String, serde_json::Value>,
    pub timeout_ms: u64,
    /// Lets `ai_claude_cancel` stop this call (a cancelled analysis).
    #[serde(default)]
    pub id: Option<String>,
}

/// What the run produced, for `interpretClaudeRun`; the problems before that are separate fields.
#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOutcome {
    /// False when Claude Code is not installed.
    pub found: bool,
    /// Set when it is installed but could not be started.
    pub start_error: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
    pub timed_out: bool,
    /// The answer went past MAX_OUTPUT.
    pub truncated: bool,
    /// Stopped by `ai_claude_cancel` or the app quitting.
    pub cancelled: bool,
}

/// Same arguments as `claudeArgs` in packages/core/src/ai/claude-output.ts.
pub fn claude_args(call: &ClaudeCall) -> Result<Vec<String>, String> {
    // Values are separate arguments (no shell), but one starting with "-" could still be read as
    // a flag by Claude Code (`--model --dangerously-skip-permissions`).
    let model_ok = !call.model.is_empty()
        && !call.model.starts_with('-')
        && call
            .model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:-[]".contains(c));
    if !model_ok {
        return Err(format!("not a model name: {:?}", call.model));
    }
    if call.system.trim_start().starts_with('-') {
        return Err("the system prompt can't start with \"-\"".into());
    }
    // Claude Code rejects the draft-2020-12 `$schema` marker that Zod adds.
    let mut schema = call.json_schema.clone();
    schema.remove("$schema");
    Ok(vec![
        "-p".into(),
        "--output-format".into(),
        "json".into(),
        "--model".into(),
        call.model.clone(),
        "--system-prompt".into(),
        call.system.clone(),
        "--json-schema".into(),
        serde_json::Value::Object(schema).to_string(),
        // Answer only: no file access, no commands, no web.
        "--tools".into(),
        String::new(),
        "--no-session-persistence".into(),
    ])
}

static CALLS: AtomicU64 = AtomicU64::new(0);

/// An empty folder for one call, removed afterwards.
struct EmptyFolder(PathBuf);

impl EmptyFolder {
    fn new() -> Result<Self, String> {
        let n = CALLS.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("knyc-ai-{}-{n}", std::process::id()));
        fs::create_dir_all(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(Self(path))
    }
}

impl Drop for EmptyFolder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Runs one call. `program` None means Claude Code is not installed; `lead` and `env` let tests
/// put a fake Claude in its place.
pub fn call_claude(
    program: Option<&Path>,
    lead: &[String],
    env: &BTreeMap<String, String>,
    call: &ClaudeCall,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<ClaudeOutcome, String> {
    let Some(program) = program else {
        return Ok(ClaudeOutcome::default());
    };
    let mut args = lead.to_vec();
    args.extend(claude_args(call)?);
    let folder = EmptyFolder::new()?;
    let mut spec = RunSpec::new("", &folder.0);
    spec.timeout = Duration::from_millis(call.timeout_ms);
    spec.stdin = Some(call.prompt.clone());
    spec.env = env.clone();
    spec.max_output = MAX_OUTPUT;
    spec.cancel = cancel;
    Ok(match run_program(program, &args, &spec) {
        Err(e) => ClaudeOutcome {
            found: true,
            start_error: Some(format!("{e:#}")),
            ..Default::default()
        },
        Ok(run) => ClaudeOutcome {
            found: true,
            start_error: None,
            truncated: run.truncated,
            stdout: run.stdout,
            stderr: run.stderr,
            code: run.exit_code,
            timed_out: run.timed_out,
            cancelled: run.cancelled,
        },
    })
}

/// The calls in flight, so they can be stopped: one by one (`ai_claude_cancel`), or all when the
/// app quits (no `claude` process outlives KnYC).
#[derive(Default)]
pub struct AiState {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AiState {
    fn start(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut running) = self.running.lock() {
            running.insert(id.to_string(), Arc::clone(&flag));
        }
        flag
    }

    fn finish(&self, id: &str) {
        if let Ok(mut running) = self.running.lock() {
            running.remove(id);
        }
    }

    pub fn cancel(&self, id: &str) -> bool {
        let running = self.running.lock();
        let flag = running.as_ref().ok().and_then(|r| r.get(id).cloned());
        flag.map(|f| f.store(true, Ordering::SeqCst)).is_some()
    }

    pub fn cancel_all(&self) {
        if let Ok(running) = self.running.lock() {
            for flag in running.values() {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }
}

/// A call takes seconds to minutes: run off the main thread.
#[tauri::command]
pub async fn ai_claude_call(app: AppHandle, call: ClaudeCall) -> Result<ClaudeOutcome, String> {
    let id = call
        .id
        .clone()
        .unwrap_or_else(|| format!("call-{}", CALLS.fetch_add(1, Ordering::Relaxed)));
    let cancel = app.state::<AiState>().start(&id);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        call_claude(
            locate_claude().as_deref(),
            &[],
            &BTreeMap::new(),
            &call,
            Some(cancel),
        )
    })
    .await
    .map_err(|e| e.to_string());
    app.state::<AiState>().finish(&id);
    outcome?
}

/// Stops a call started with this `id`; false when it already ended.
#[tauri::command]
pub fn ai_claude_cancel(state: State<'_, AiState>, id: String) -> bool {
    state.cancel(&id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fake Claude Code of the core tests (packages/core/tests/fixtures/fake-claude.mjs).
    fn fake_claude() -> Vec<String> {
        let script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/core/tests/fixtures/fake-claude.mjs");
        vec![dunce::canonicalize(script).unwrap().display().to_string()]
    }

    fn call(timeout_ms: u64) -> ClaudeCall {
        ClaudeCall {
            model: "haiku".into(),
            system: "You name programmers.".into(),
            prompt: "Name one \"famous\" programmer.".into(),
            json_schema: serde_json::json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": { "name": { "type": "string" } }
            })
            .as_object()
            .unwrap()
            .clone(),
            timeout_ms,
            id: None,
        }
    }

    fn run_fake(mode: &str, timeout_ms: u64) -> ClaudeOutcome {
        run_fake_with(mode, timeout_ms, None)
    }

    fn run_fake_with(
        mode: &str,
        timeout_ms: u64,
        cancel: Option<Arc<AtomicBool>>,
    ) -> ClaudeOutcome {
        let env = BTreeMap::from([
            ("FAKE_CLAUDE_MODE".to_string(), mode.to_string()),
            (
                "FAKE_CLAUDE_ANSWER".to_string(),
                r#"{"name":"Ada"}"#.to_string(),
            ),
        ]);
        call_claude(
            Some(Path::new("node")),
            &fake_claude(),
            &env,
            &call(timeout_ms),
            cancel,
        )
        .unwrap()
    }

    #[test]
    fn answer_only_call_in_an_empty_folder() {
        let outcome = run_fake("structured", 30_000);
        assert!(
            outcome.found && outcome.start_error.is_none() && !outcome.timed_out,
            "{outcome:?}"
        );
        let json: serde_json::Value = serde_json::from_str(outcome.stdout.trim()).unwrap();
        assert_eq!(json["structured_output"]["name"], "Ada");

        let echo = &json["echo"];
        assert_eq!(echo["stdin"], "Name one \"famous\" programmer.");
        let args: Vec<String> = serde_json::from_value(echo["args"].clone()).unwrap();
        let after = |flag: &str| args[args.iter().position(|a| a == flag).unwrap() + 1].clone();
        assert_eq!(after("--model"), "haiku");
        assert_eq!(after("--tools"), "");
        assert!(args.contains(&"--no-session-persistence".to_string()));
        let schema: serde_json::Value = serde_json::from_str(&after("--json-schema")).unwrap();
        assert!(schema.get("$schema").is_none(), "{schema}");
        // It ran in an empty temporary folder, which is gone afterwards.
        let cwd = PathBuf::from(echo["cwd"].as_str().unwrap());
        assert!(
            cwd.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("knyc-ai-")
        );
        assert!(!cwd.exists());
    }

    #[test]
    fn reports_each_problem_for_the_shared_reader() {
        assert_eq!(
            call_claude(None, &[], &BTreeMap::new(), &call(1000), None).unwrap(),
            ClaudeOutcome::default()
        );
        let missing = call_claude(
            Some(Path::new("definitely-not-claude-knyc")),
            &[],
            &BTreeMap::new(),
            &call(1000),
            None,
        )
        .unwrap();
        assert!(
            missing.found && missing.start_error.is_some(),
            "{missing:?}"
        );

        // Cancelled from another thread, as `ai_claude_cancel` and quitting the app do.
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancel);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            flag.store(true, Ordering::SeqCst);
        });
        let cancelled = run_fake_with("hang", 60_000, Some(cancel));
        assert!(cancelled.cancelled && !cancelled.timed_out, "{cancelled:?}");

        assert!(run_fake("hang", 500).timed_out);
        let crash = run_fake("crash", 30_000);
        assert_eq!(crash.code, Some(3));
        assert!(crash.stderr.contains("segfault-ish"));
        assert!(run_fake("auth", 30_000).stdout.contains("authenticate"));
        assert!(run_fake("limit", 30_000).stdout.contains("session limit"));
    }

    #[test]
    fn values_cannot_become_flags() {
        for model in [
            "",
            "--dangerously-skip-permissions",
            "-x",
            "son net",
            "haiku;rm",
        ] {
            let bad = ClaudeCall {
                model: model.into(),
                ..call(1000)
            };
            assert!(claude_args(&bad).is_err(), "{model:?}");
        }
        assert!(
            claude_args(&ClaudeCall {
                model: "claude-sonnet-5-5[1m]".into(),
                ..call(1000)
            })
            .is_ok()
        );
        let bad = ClaudeCall {
            system: "  --tools Bash".into(),
            ..call(1000)
        };
        assert!(claude_args(&bad).is_err());
    }
}
