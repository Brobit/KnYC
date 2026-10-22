//! Long-running commands with live output, for the Run panel: `npm run dev` streams its logs
//! until the learner stops it. Like [`crate::run`], the command runs in its own process group
//! (job object on Windows), so stopping it takes the whole tree down, dev servers included.

use crate::pty::Utf8Stream;
use crate::run::shell;
use command_group::{CommandGroup, GroupChild};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamKind {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    /// None when stopped or ended by a signal.
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    /// True when the learner stopped it.
    pub stopped: bool,
}

type OutputSink = Box<dyn FnMut(StreamKind, String) + Send>;

pub struct StreamCallbacks {
    pub on_output: OutputSink,
    /// Called once, after all output.
    pub on_exit: Box<dyn FnOnce(Finished) + Send>,
}

/// A running command. Dropping it stops the command.
pub struct RunningCommand {
    child: Arc<Mutex<GroupChild>>,
    stopped: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
}

fn pump(
    mut stream: impl Read + Send + 'static,
    kind: StreamKind,
    sink: Arc<Mutex<OutputSink>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut decoder = Utf8Stream::default();
        let mut buf = [0u8; 8192];
        let send = |text: String| {
            if !text.is_empty()
                && let Ok(mut sink) = sink.lock()
            {
                sink(kind, text);
            }
        };
        while let Ok(n) = stream.read(&mut buf) {
            if n == 0 {
                break;
            }
            send(decoder.push(&buf[..n]));
        }
        send(decoder.finish());
    })
}

impl RunningCommand {
    /// Starts `command` (a shell command line) in `cwd`. An error means it couldn't start.
    pub fn start(
        command: &str,
        cwd: &Path,
        env: &BTreeMap<String, String>,
        callbacks: StreamCallbacks,
    ) -> anyhow::Result<Self> {
        let mut cmd = shell(command);
        cmd.current_dir(cwd)
            .envs(env)
            // Colors make dev-server logs readable; the panel renders them.
            .env("FORCE_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let started = Instant::now();
        let mut child = cmd.group_spawn()?;
        let stdout = child.inner().stdout.take().expect("piped");
        let stderr = child.inner().stderr.take().expect("piped");

        let StreamCallbacks { on_output, on_exit } = callbacks;
        let sink = Arc::new(Mutex::new(on_output));
        let readers = [
            pump(stdout, StreamKind::Stdout, Arc::clone(&sink)),
            pump(stderr, StreamKind::Stderr, sink),
        ];

        let child = Arc::new(Mutex::new(child));
        let stopped = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));
        let (waiter_child, waiter_stopped, waiter_done) =
            (Arc::clone(&child), Arc::clone(&stopped), Arc::clone(&done));
        thread::spawn(move || {
            // Polled so `stop` can lock the child to kill it meanwhile.
            let status = loop {
                match waiter_child.lock().map(|mut c| c.try_wait()) {
                    Ok(Ok(Some(status))) => break Some(status),
                    Ok(Ok(None)) => {}
                    _ => break None,
                }
                thread::sleep(Duration::from_millis(25));
            };
            // The pipes close once every process of the group is gone.
            for reader in readers {
                let _ = reader.join();
            }
            waiter_done.store(true, Ordering::SeqCst);
            let stopped = waiter_stopped.load(Ordering::SeqCst);
            on_exit(Finished {
                exit_code: if stopped {
                    None
                } else {
                    status.and_then(|s| s.code())
                },
                duration_ms: started.elapsed().as_millis() as u64,
                stopped,
            });
        });

        Ok(Self {
            child,
            stopped,
            done,
        })
    }

    /// Kills the command and everything it started.
    pub fn stop(&self) {
        if self.done.load(Ordering::SeqCst) {
            return;
        }
        self.stopped.store(true, Ordering::SeqCst);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

impl Drop for RunningCommand {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{Receiver, channel};

    enum Event {
        Output(StreamKind, String),
        Exit(Finished),
    }

    /// Node scripts in double quotes, as in run.rs tests: single quotes only inside.
    fn node(script: &str) -> String {
        assert!(!script.contains(['"', '`', '$']));
        format!("node -e \"{script}\"")
    }

    fn start(command: &str, cwd: &Path) -> (RunningCommand, Receiver<Event>) {
        let (tx, rx) = channel();
        let exit_tx = tx.clone();
        let running = RunningCommand::start(
            command,
            cwd,
            &BTreeMap::new(),
            StreamCallbacks {
                on_output: Box::new(move |kind, text| {
                    let _ = tx.send(Event::Output(kind, text));
                }),
                on_exit: Box::new(move |finished| {
                    let _ = exit_tx.send(Event::Exit(finished));
                }),
            },
        )
        .unwrap();
        (running, rx)
    }

    /// Output per stream until the exit event, or a panic after 30 s.
    fn until_exit(rx: &Receiver<Event>) -> (String, String, Finished) {
        let (mut out, mut err) = (String::new(), String::new());
        loop {
            match rx
                .recv_timeout(Duration::from_secs(30))
                .expect("no exit within 30 s")
            {
                Event::Output(StreamKind::Stdout, text) => out.push_str(&text),
                Event::Output(StreamKind::Stderr, text) => err.push_str(&text),
                Event::Exit(finished) => return (out, err, finished),
            }
        }
    }

    #[test]
    fn streams_both_outputs_then_the_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let (_running, rx) = start(
            &node(
                "console.log('one'); console.error('oops'); setTimeout(()=>{console.log('two'); process.exit(4)}, 200)",
            ),
            dir.path(),
        );
        let (out, err, finished) = until_exit(&rx);
        assert_eq!(out.split_whitespace().collect::<Vec<_>>(), ["one", "two"]);
        assert_eq!(err.trim(), "oops");
        assert_eq!(finished.exit_code, Some(4));
        assert!(!finished.stopped);
        assert!(finished.duration_ms >= 150, "{finished:?}");
    }

    #[test]
    fn stop_kills_the_whole_tree() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("grandchild.pid");
        // A "dev server" that starts a child process and keeps running, like `npm run dev`.
        let script = "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); require('fs').writeFileSync('grandchild.pid', String(c.pid)); console.log('ready'); setInterval(()=>{},1000)";
        let (running, rx) = start(&node(script), dir.path());

        match rx.recv_timeout(Duration::from_secs(30)).expect("no output") {
            Event::Output(_, text) => assert!(text.contains("ready"), "{text:?}"),
            Event::Exit(finished) => panic!("exited early: {finished:?}"),
        }
        let grandchild: u32 = std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(alive(grandchild));

        running.stop();
        let (_, _, finished) = until_exit(&rx);
        assert!(finished.stopped);
        assert_eq!(finished.exit_code, None);
        let deadline = Instant::now() + Duration::from_secs(10);
        while alive(grandchild) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(100));
        }
        assert!(
            !alive(grandchild),
            "the grandchild {grandchild} survived the stop"
        );
    }

    /// Whether a process is still running, asked to the OS without killing it.
    fn alive(pid: u32) -> bool {
        let check = if cfg!(windows) {
            format!("tasklist /FI \"PID eq {pid}\" /NH")
        } else {
            format!("kill -0 {pid} && echo alive")
        };
        let out = crate::run::run(&crate::run::RunSpec::new(check, std::env::temp_dir())).unwrap();
        if cfg!(windows) {
            out.stdout.contains(&pid.to_string())
        } else {
            out.stdout.contains("alive")
        }
    }
}
