//! Interactive shells for the terminal panel (design/01: portable-pty, ConPTY on Windows).
//! Output is decoded as UTF-8 across read boundaries and handed to a callback; the exit code
//! arrives after the last output.

use anyhow::{Context, Result, anyhow};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// The learner's shell: PowerShell on Windows, `$SHELL` (as a login shell, so the PATH from
/// their profile is there even when the app was started from the Finder) elsewhere.
pub fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/bin/sh".into());
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd
    }
}

/// Decodes a byte stream as UTF-8 when a character can be split between two reads.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    out.push_str(text);
                    self.pending.clear();
                    return out;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    out.push_str(
                        std::str::from_utf8(&self.pending[..valid]).expect("valid prefix"),
                    );
                    match error.error_len() {
                        // An incomplete character at the end: wait for the rest.
                        None => {
                            self.pending.drain(..valid);
                            return out;
                        }
                        Some(len) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            self.pending.drain(..valid + len);
                        }
                    }
                }
            }
        }
    }

    /// Whatever is left when the stream ends.
    pub fn finish(&mut self) -> String {
        let rest = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        rest
    }
}

struct Live {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

/// A running shell. Dropping it kills the shell.
pub struct PtySession {
    live: Arc<Mutex<Option<Live>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub struct PtyCallbacks {
    pub on_output: Box<dyn FnMut(String) + Send>,
    /// Called once, after the last output; None when the exit code is unknown.
    pub on_exit: Box<dyn FnOnce(Option<u32>) + Send>,
}

impl PtySession {
    pub fn spawn(
        mut cmd: CommandBuilder,
        cwd: &Path,
        cols: u16,
        rows: u16,
        callbacks: PtyCallbacks,
    ) -> Result<Self> {
        cmd.cwd(cwd);
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("could not open a pseudo-terminal")?;
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .context("could not start the shell")?;
        // Only the child keeps the slave end, so the reader sees the end when it exits (Unix).
        drop(pair.slave);
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let killer = child.clone_killer();
        let live = Arc::new(Mutex::new(Some(Live {
            master: pair.master,
            writer,
        })));

        let (code_tx, code_rx) = mpsc::channel();
        let waiter_live = Arc::clone(&live);
        thread::spawn(move || {
            let code = child.wait().ok().map(|status| status.exit_code());
            let _ = code_tx.send(code);
            // With ConPTY the reader only ends once the pseudo-console is closed; give it a
            // moment to deliver the last output first.
            thread::sleep(Duration::from_millis(100));
            if let Ok(mut live) = waiter_live.lock() {
                live.take();
            }
        });

        let PtyCallbacks {
            mut on_output,
            on_exit,
        } = callbacks;
        let reader_live = Arc::clone(&live);
        thread::spawn(move || {
            let mut reader = reader;
            let mut decoder = Utf8Stream::default();
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = decoder.push(&buf[..n]);
                        if !text.is_empty() {
                            on_output(text);
                        }
                    }
                }
            }
            let rest = decoder.finish();
            if !rest.is_empty() {
                on_output(rest);
            }
            let code = code_rx.recv_timeout(Duration::from_secs(5)).ok().flatten();
            // Closed before reporting the exit, so a reported exit always means writes fail.
            if let Ok(mut live) = reader_live.lock() {
                live.take();
            }
            on_exit(code);
        });

        Ok(Self { live, killer })
    }

    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut live = self.live.lock().map_err(|e| anyhow!(e.to_string()))?;
        let live = live
            .as_mut()
            .ok_or_else(|| anyhow!("the terminal has exited"))?;
        live.writer.write_all(data)?;
        live.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let live = self.live.lock().map_err(|e| anyhow!(e.to_string()))?;
        let live = live
            .as_ref()
            .ok_or_else(|| anyhow!("the terminal has exited"))?;
        live.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    /// Ends the shell; its programs go with it (the pseudo-terminal closes under them).
    pub fn kill(&mut self) {
        let _ = self.killer.kill();
        if let Ok(mut live) = self.live.lock() {
            live.take();
        }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{Receiver, channel};
    use std::time::Instant;

    enum Event {
        Output(String),
        Exit(Option<u32>),
    }

    /// A plain shell that reads commands from the terminal: cmd on Windows (PowerShell starts
    /// slowly on CI), sh elsewhere.
    fn test_shell() -> (CommandBuilder, &'static str) {
        if cfg!(windows) {
            let mut cmd = CommandBuilder::new("cmd.exe");
            cmd.args(["/Q", "/K"]);
            (cmd, "\r\n")
        } else {
            (CommandBuilder::new("/bin/sh"), "\n")
        }
    }

    fn spawn(cwd: &Path) -> (PtySession, Receiver<Event>, &'static str) {
        let (cmd, newline) = test_shell();
        let (tx, rx) = channel();
        let exit_tx = tx.clone();
        let session = PtySession::spawn(
            cmd,
            cwd,
            80,
            24,
            PtyCallbacks {
                on_output: Box::new(move |text| {
                    let _ = tx.send(Event::Output(text));
                }),
                on_exit: Box::new(move |code| {
                    let _ = exit_tx.send(Event::Exit(code));
                }),
            },
        )
        .unwrap();
        (session, rx, newline)
    }

    /// Collects output until `done` says so or the shell exits. Like a real terminal, it answers
    /// cursor-position queries: ConPTY waits for that answer before running anything.
    fn collect(
        session: &PtySession,
        rx: &Receiver<Event>,
        done: impl Fn(&str) -> bool,
    ) -> (String, Option<Option<u32>>) {
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut output = String::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Event::Output(text)) => {
                    if text.contains("[6n") {
                        let _ = session.write(b"[1;1R");
                    }
                    output.push_str(&text);
                    if done(&output) {
                        return (output, None);
                    }
                }
                Ok(Event::Exit(code)) => return (output, Some(code)),
                Err(_) => {}
            }
        }
        panic!("timed out; output so far: {output:?}");
    }

    #[test]
    fn runs_commands_in_the_folder_and_reports_the_exit() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dunce::canonicalize(dir.path()).unwrap();
        std::fs::write(folder.join("marker-file.txt"), "").unwrap();
        let (session, rx, nl) = spawn(&folder);

        let list = if cfg!(windows) { "dir /b" } else { "ls" };
        session
            .write(format!("echo got:hi{nl}{list}{nl}").as_bytes())
            .unwrap();
        let (output, exited) = collect(&session, &rx, |out| {
            out.contains("got:hi") && out.contains("marker-file.txt")
        });
        assert!(exited.is_none(), "shell exited early: {output:?}");

        session.resize(120, 40).unwrap();
        session.write(format!("exit 3{nl}").as_bytes()).unwrap();
        let (_, exited) = collect(&session, &rx, |_| false);
        assert_eq!(exited, Some(Some(3)));
        assert!(session.write(b"echo late").is_err());
    }

    #[test]
    fn kill_ends_the_shell() {
        let dir = tempfile::tempdir().unwrap();
        let (mut session, rx, _) = spawn(dir.path());
        session.kill();
        let (_, exited) = collect(&session, &rx, |_| false);
        assert!(exited.is_some());
    }

    #[test]
    fn utf8_split_across_reads() {
        let mut stream = Utf8Stream::default();
        let bytes = "é✓🙂".as_bytes();
        let mut out = String::new();
        for byte in bytes {
            out.push_str(&stream.push(&[*byte]));
        }
        out.push_str(&stream.finish());
        assert_eq!(out, "é✓🙂");

        let mut stream = Utf8Stream::default();
        assert_eq!(stream.push(&[b'a', 0xff, b'b']), "a\u{FFFD}b");
        assert_eq!(stream.push(&[0xe2, 0x9c]), "");
        assert_eq!(stream.finish(), "\u{FFFD}");
    }

    #[test]
    fn default_shell_is_the_platform_shell() {
        let shell = default_shell();
        let program = shell.get_argv()[0].to_string_lossy().to_lowercase();
        if cfg!(windows) {
            assert!(program.contains("powershell"));
        } else {
            assert!(program.starts_with('/'));
        }
    }
}
