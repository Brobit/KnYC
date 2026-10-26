//! Runs one shell command with a timeout. The whole process tree is killed on timeout (process
//! group on Unix, job object on Windows), so `npm start` can't leave a server running.

use command_group::CommandGroup;
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

/// Stored output per stream (design 03: output truncated to 64 KB).
pub const DEFAULT_MAX_OUTPUT: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct RunSpec {
    /// Shell command line: "npm run build", "npx vitest run".
    pub command: String,
    pub cwd: PathBuf,
    pub env: BTreeMap<String, String>,
    pub stdin: Option<String>,
    pub timeout: Duration,
    pub max_output: usize,
    /// Set from another thread to stop the run (a cancelled job): the process tree is killed.
    pub cancel: Option<Arc<AtomicBool>>,
    /// Docker mode (#91): run the command inside this container instead of on the machine.
    pub container: Option<crate::container::Container>,
}

impl RunSpec {
    pub fn new(command: impl Into<String>, cwd: impl Into<PathBuf>) -> Self {
        Self {
            command: command.into(),
            cwd: cwd.into(),
            env: BTreeMap::new(),
            stdin: None,
            timeout: Duration::from_secs(60),
            max_output: DEFAULT_MAX_OUTPUT,
            cancel: None,
            container: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    /// None when killed (timeout) or terminated by a signal.
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub duration_ms: u64,
    pub stdout: String,
    pub stderr: String,
    /// True when some output was dropped because of `max_output`.
    pub truncated: bool,
    /// True when stopped through `RunSpec::cancel`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub cancelled: bool,
}

impl RunResult {
    pub fn success(&self) -> bool {
        !self.timed_out && !self.cancelled && self.exit_code == Some(0)
    }
}

#[cfg(windows)]
pub(crate) fn shell(command: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut c = Command::new("cmd");
    // Passed as-is: Rust's default argument quoting isn't what cmd.exe expects. With /S, cmd
    // removes the outer quotes and runs the rest exactly as typed.
    c.args(["/D", "/S", "/C"]).raw_arg(format!("\"{command}\""));
    c
}

#[cfg(not(windows))]
pub(crate) fn shell(command: &str) -> Command {
    let mut c = Command::new("sh");
    c.args(["-c", command]);
    c
}

/// Reads a stream to the end (so the child never blocks on a full pipe), keeping at most `max`
/// bytes. Returns the kept text and whether anything was dropped.
fn capture(
    mut stream: impl Read + Send + 'static,
    max: usize,
) -> thread::JoinHandle<(String, bool)> {
    thread::spawn(move || {
        let mut kept = Vec::new();
        let mut dropped = false;
        let mut buf = [0u8; 8192];
        while let Ok(n) = stream.read(&mut buf) {
            if n == 0 {
                break;
            }
            let room = max.saturating_sub(kept.len());
            kept.extend_from_slice(&buf[..n.min(room)]);
            dropped |= n > room;
        }
        (String::from_utf8_lossy(&kept).into_owned(), dropped)
    })
}

/// Runs the command. An error means it couldn't start; a failing command is a normal result.
pub fn run(spec: &RunSpec) -> anyhow::Result<RunResult> {
    if let Some(container) = &spec.container {
        let args = crate::container::docker_args(
            container,
            &spec.command,
            &spec.cwd,
            &spec.env,
            &[],
            None,
        )?;
        let mut command = Command::new("docker");
        command.args(args);
        return execute(command, spec, true);
    }
    execute(shell(&spec.command), spec, false)
}

/// Runs `program` with `args` as they are, without a shell: for arguments a shell would mangle
/// (JSON schemas, prompts with quotes). `spec.command` is ignored. No console window on Windows.
pub fn run_program(
    program: &std::path::Path,
    args: &[String],
    spec: &RunSpec,
) -> anyhow::Result<RunResult> {
    let mut command = Command::new(program);
    command.args(args);
    execute(command, spec, true)
}

fn execute(mut command: Command, spec: &RunSpec, hide_window: bool) -> anyhow::Result<RunResult> {
    command
        .current_dir(&spec.cwd)
        .envs(&spec.env)
        // Keep tools quiet and deterministic.
        .env("CI", "true")
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1")
        .stdin(if spec.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let started = Instant::now();
    let mut group = command.group();
    // command-group sets the creation flags itself, so they go through its builder.
    #[cfg(windows)]
    if hide_window {
        group.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = hide_window;
    let mut child = group.spawn()?;
    if let Some(input) = &spec.stdin
        && let Some(mut stdin) = child.inner().stdin.take()
    {
        let input = input.clone();
        thread::spawn(move || {
            let _ = stdin.write_all(input.as_bytes());
        });
    }
    let stdout = capture(child.inner().stdout.take().expect("piped"), spec.max_output);
    let stderr = capture(child.inner().stderr.take().expect("piped"), spec.max_output);

    let mut timed_out = false;
    let mut cancelled = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        cancelled = spec
            .cancel
            .as_ref()
            .is_some_and(|c| c.load(Ordering::SeqCst));
        timed_out = !cancelled && started.elapsed() >= spec.timeout;
        if cancelled || timed_out {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        thread::sleep(Duration::from_millis(15));
    };
    let duration_ms = started.elapsed().as_millis() as u64;

    let (stdout, out_dropped) = stdout.join().unwrap_or_default();
    let (stderr, err_dropped) = stderr.join().unwrap_or_default();
    Ok(RunResult {
        exit_code: status.and_then(|s| s.code()),
        timed_out,
        duration_ms,
        stdout,
        stderr,
        truncated: out_dropped || err_dropped,
        cancelled,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Node is required to develop KnYC, so tests use it as a portable scripting language.
    /// Scripts must only use single quotes (see the assertion).
    fn node(script: &str, cwd: &std::path::Path) -> RunSpec {
        // Inside double quotes, sh treats ` and $ as shell syntax, and cmd ends the script at ".
        assert!(
            !script.contains(['"', '`', '$']),
            "test scripts may only use single quotes (no \", ` or $)"
        );
        RunSpec::new(format!("node -e \"{script}\""), cwd)
    }

    #[test]
    fn captures_output_and_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let r = run(&node(
            "console.log('out'); console.error('err'); process.exit(3)",
            dir.path(),
        ))
        .unwrap();
        assert_eq!(r.exit_code, Some(3));
        assert!(!r.success());
        assert_eq!(r.stdout.trim(), "out");
        assert_eq!(r.stderr.trim(), "err");
        assert!(!r.timed_out && !r.truncated);
    }

    #[test]
    fn runs_in_the_given_folder_with_env_and_stdin() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("marker.txt"), "here").unwrap();
        let mut spec = node(
            "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(require('fs').readFileSync('marker.txt','utf8'), process.env.GREETING, s.trim()))",
            dir.path(),
        );
        spec.env.insert("GREETING".into(), "hello".into());
        spec.stdin = Some("from stdin\n".into());
        let r = run(&spec).unwrap();
        assert!(r.success(), "{r:?}");
        assert_eq!(r.stdout.trim(), "here hello from stdin");
    }

    #[test]
    fn truncates_large_output() {
        let dir = tempfile::tempdir().unwrap();
        let mut spec = node("process.stdout.write('x'.repeat(200000))", dir.path());
        spec.max_output = 1000;
        let r = run(&spec).unwrap();
        assert!(r.success());
        assert_eq!(r.stdout.len(), 1000);
        assert!(r.truncated);
    }

    /// A child that starts a grandchild writing `flag` after 1.5 s, then stays alive for 4 s.
    /// It ends on its own: a leftover process would keep `cargo test`'s output pipes open.
    ///
    /// Both scripts are files run with `node <file>`: inline `node -e "…"` scripts get mangled by
    /// sh (backticks and `$` are shell syntax inside double quotes), which once made this test
    /// pass on Unix for the wrong reason.
    fn tree_spec(dir: &std::path::Path) -> (RunSpec, PathBuf) {
        let flag = dir.join("grandchild-alive.txt");
        std::fs::write(
            dir.join("grandchild.js"),
            "setTimeout(() => require('fs').writeFileSync('grandchild-alive.txt', 'alive'), 1500);\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("child.js"),
            "require('child_process').spawn(process.execPath, ['grandchild.js'], { stdio: 'ignore' });\nsetTimeout(() => process.exit(0), 4000);\n",
        )
        .unwrap();
        (RunSpec::new("node child.js", dir), flag)
    }

    #[test]
    fn tree_scripts_really_write_the_flag() {
        // Without any kill, the grandchild must write its file; otherwise the kill tests prove nothing.
        let dir = tempfile::tempdir().unwrap();
        let (spec, flag) = tree_spec(dir.path());
        let r = run(&spec).unwrap();
        assert!(r.success(), "{r:?}");
        assert!(flag.exists(), "the grandchild never wrote its file");
    }

    #[test]
    fn control_a_plain_kill_leaves_the_grandchild_running() {
        // Proves the next test can fail: killing only the shell leaves the tree alive.
        let dir = tempfile::tempdir().unwrap();
        let (spec, flag) = tree_spec(dir.path());
        let mut child = shell(&spec.command)
            .current_dir(dir.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        thread::sleep(Duration::from_millis(600));
        child.kill().unwrap();
        let _ = child.wait();
        thread::sleep(Duration::from_millis(2500));
        assert!(
            flag.exists(),
            "control failed: the grandchild died with the shell"
        );
    }

    #[test]
    fn timeout_kills_the_whole_process_tree() {
        let dir = tempfile::tempdir().unwrap();
        let (mut spec, flag) = tree_spec(dir.path());
        spec.timeout = Duration::from_millis(600);

        let r = run(&spec).unwrap();
        assert!(r.timed_out);
        assert_eq!(r.exit_code, None);
        assert!(r.duration_ms < 5000);

        thread::sleep(Duration::from_millis(2500));
        assert!(!flag.exists(), "the grandchild survived the timeout");
    }

    #[test]
    fn unknown_commands_fail_normally() {
        let dir = tempfile::tempdir().unwrap();
        let r = run(&RunSpec::new("definitely-not-a-command-knyc", dir.path())).unwrap();
        assert!(!r.success());
        assert!(!r.stderr.is_empty());
    }

    #[test]
    fn cancel_stops_the_run() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let mut spec = node("setTimeout(()=>{}, 60000)", dir.path());
        spec.timeout = Duration::from_secs(60);
        spec.cancel = Some(Arc::clone(&cancel));
        let flag = Arc::clone(&cancel);
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            flag.store(true, Ordering::SeqCst);
        });
        let r = run(&spec).unwrap();
        assert!(r.cancelled && !r.timed_out && !r.success(), "{r:?}");
        assert!(r.duration_ms < 10_000, "{r:?}");
    }

    #[test]
    fn run_program_passes_arguments_untouched() {
        let dir = tempfile::tempdir().unwrap();
        // Everything a shell would mangle: JSON, quotes, spaces, an empty argument (`--tools ""`).
        let tricky = [
            r#"{"type":"object","properties":{"a":{"type":"string"}}}"#,
            "",
            r#"it's "quoted" & <piped> | %PATH% $HOME"#,
        ];
        let mut args = vec![
            "-e".to_string(),
            "console.log(JSON.stringify(process.argv.slice(1)))".to_string(),
        ];
        args.extend(tricky.iter().map(|a| a.to_string()));
        let mut spec = RunSpec::new("", dir.path());
        spec.stdin = Some("ignored".into());
        let r = run_program(std::path::Path::new("node"), &args, &spec).unwrap();
        assert!(r.success(), "{r:?}");
        let seen: Vec<String> = serde_json::from_str(r.stdout.trim()).unwrap();
        assert_eq!(seen, tricky);
    }
}
