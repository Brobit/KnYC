//! The PATH of the learner's shell, for an app opened from the Finder or a desktop menu.
//!
//! Such an app starts with the system PATH only (`/usr/bin:/bin:/usr/sbin:/sbin` on macOS), so
//! `npm`, `node` or `claude` installed by nvm, Homebrew or an installer are not found by checks,
//! runs and the toolchain status, though the built-in terminal (a login shell) finds them. At
//! start-up we ask the user's shell for its PATH once, the way a terminal would set it up, and use
//! that for the whole app. Windows apps get the user's PATH from the system: nothing to do there.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Printed around the PATH so whatever the shell's startup files print is ignored.
const MARKER: &str = "__KNYC_PATH__";

/// A slow or stuck shell startup must not hold the app back for long.
const TIMEOUT: Duration = Duration::from_secs(5);

/// Replaces this process's PATH with the one of the user's shell. Keeps the current one on any
/// failure (no `$SHELL`, a startup error, a timeout).
pub fn adopt_shell_path() {
    if cfg!(windows) {
        return;
    }
    let Ok(shell) = std::env::var("SHELL") else {
        return;
    };
    if let Some(path) = shell_path(&shell) {
        // Called first thing in `run()`, before any thread starts.
        unsafe { std::env::set_var("PATH", path) };
    }
}

/// The PATH as an interactive login `shell` sets it up (`-i` for ~/.zshrc / ~/.bashrc, where nvm
/// usually lives; `-l` for ~/.zprofile / ~/.profile, where Homebrew does).
fn shell_path(shell: &str) -> Option<String> {
    let script = format!("printf '%s' \"{MARKER}${{PATH}}{MARKER}\"");
    let mut child = Command::new(shell)
        .args(["-i", "-l", "-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait().ok()? {
            Some(_) => break,
            None if started.elapsed() > TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    let mut output = String::new();
    child.stdout.take()?.read_to_string(&mut output).ok()?;
    path_from_output(&output)
}

/// The PATH between the two markers, if it is not empty.
fn path_from_output(output: &str) -> Option<String> {
    let start = output.find(MARKER)? + MARKER.len();
    let end = start + output[start..].find(MARKER)?;
    let path = output[start..end].trim();
    (!path.is_empty()).then(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_path_between_the_markers() {
        let output = format!("Welcome!\n{MARKER}/opt/homebrew/bin:/usr/bin{MARKER}\nbye");
        assert_eq!(
            path_from_output(&output).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
    }

    #[test]
    fn refuses_a_missing_or_empty_path() {
        assert_eq!(path_from_output("no markers here"), None);
        assert_eq!(path_from_output(&format!("{MARKER}{MARKER}")), None);
        assert_eq!(path_from_output(&format!("{MARKER}/usr/bin")), None);
    }

    #[cfg(unix)]
    #[test]
    fn asks_a_real_shell() {
        let path = shell_path("/bin/sh").expect("sh prints its PATH");
        assert!(path.contains("/bin"), "{path}");
    }

    #[cfg(unix)]
    #[test]
    fn gives_up_on_a_missing_shell() {
        assert_eq!(shell_path("/no/such/shell"), None);
    }
}
