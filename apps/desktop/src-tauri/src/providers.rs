//! What the Settings screen shows about local AI tools: is the Claude Code CLI installed, which
//! version, is it logged in. Same lookup as `findClaude` in packages/core (PATH, then ~/.local/bin).

use knyc_runner::run::{RunSpec, run};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCliStatus {
    /// None when not installed.
    pub path: Option<String>,
    pub version: Option<String>,
    /// None when unknown (not installed, or `claude auth status` failed).
    pub logged_in: Option<bool>,
}

/// `.cmd` shims are skipped: they need a shell to run (same rule as packages/core).
fn executable_name() -> &'static str {
    if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    }
}

pub fn find_claude(path_var: Option<&str>, home: Option<&Path>) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = path_var
        .map(|p| std::env::split_paths(p).collect())
        .unwrap_or_default();
    if let Some(home) = home {
        dirs.push(home.join(".local").join("bin"));
    }
    dirs.into_iter()
        .filter(|d| !d.as_os_str().is_empty())
        .map(|d| d.join(executable_name()))
        .find(|candidate| candidate.is_file())
}

/// "2.1.272 (Claude Code)" → "2.1.272".
pub fn parse_version(stdout: &str) -> Option<String> {
    stdout.split_whitespace().next().map(str::to_string)
}

/// `claude auth status` prints JSON with `loggedIn`. Only that field is read: the rest (email,
/// organisation) stays out of KnYC.
pub fn parse_logged_in(stdout: &str) -> Option<bool> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    value.get("loggedIn")?.as_bool()
}

/// The command's stdout, whatever its exit code (`auth status` may exit 1 when logged out).
fn run_claude(program: &Path, args: &str) -> Option<String> {
    let mut spec = RunSpec::new(
        format!("\"{}\" {args}", program.display()),
        std::env::temp_dir(),
    );
    spec.timeout = Duration::from_secs(15);
    let result = run(&spec).ok()?;
    (!result.timed_out).then_some(result.stdout)
}

/// The Claude Code executable of this machine (PATH, then ~/.local/bin).
pub fn locate_claude() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    let path_var = std::env::var("PATH").ok();
    find_claude(path_var.as_deref(), home.as_deref())
}

pub fn claude_status() -> ClaudeCliStatus {
    let Some(program) = locate_claude() else {
        return ClaudeCliStatus {
            path: None,
            version: None,
            logged_in: None,
        };
    };
    ClaudeCliStatus {
        path: Some(program.display().to_string()),
        version: run_claude(&program, "--version").and_then(|out| parse_version(&out)),
        logged_in: run_claude(&program, "auth status").and_then(|out| parse_logged_in(&out)),
    }
}

/// Runs two short processes: async so the window stays responsive.
#[tauri::command]
pub async fn claude_cli_status() -> ClaudeCliStatus {
    claude_status()
}

/// The toolchains onboarding lists: what M3 needs first, then the later stacks.
pub const TOOLCHAINS: &[&str] = &["node", "npm", "git", "docker", "python", "go", "dotnet"];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolchainStatus {
    pub id: &'static str,
    /// None when not found.
    pub version: Option<String>,
}

/// Every toolchain's installed version, checked in parallel (each is one short process).
pub fn check_toolchains() -> Vec<ToolchainStatus> {
    std::thread::scope(|scope| {
        let checks: Vec<_> = TOOLCHAINS
            .iter()
            .map(|id| scope.spawn(move || knyc_analyzer::scan::installed_version(id)))
            .collect();
        TOOLCHAINS
            .iter()
            .zip(checks)
            .map(|(id, check)| ToolchainStatus {
                id,
                version: check.join().ok().flatten(),
            })
            .collect()
    })
}

#[tauri::command]
pub async fn toolchains_status() -> Vec<ToolchainStatus> {
    tauri::async_runtime::spawn_blocking(check_toolchains)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_every_toolchain_with_node_found() {
        let found = check_toolchains();
        assert_eq!(found.iter().map(|t| t.id).collect::<Vec<_>>(), TOOLCHAINS);
        // Node is installed wherever KnYC is developed.
        assert!(found[0].version.is_some(), "{found:?}");
    }

    #[test]
    fn finds_claude_on_path_then_in_local_bin() {
        let path_dir = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let local_bin = home.path().join(".local").join("bin");
        std::fs::create_dir_all(&local_bin).unwrap();
        std::fs::write(local_bin.join(executable_name()), "").unwrap();

        let path_var = std::env::join_paths([path_dir.path()]).unwrap();
        let path_var = path_var.to_str().unwrap();
        assert_eq!(
            find_claude(Some(path_var), Some(home.path())),
            Some(local_bin.join(executable_name()))
        );

        std::fs::write(path_dir.path().join(executable_name()), "").unwrap();
        assert_eq!(
            find_claude(Some(path_var), Some(home.path())),
            Some(path_dir.path().join(executable_name()))
        );
        assert_eq!(find_claude(None, None), None);
    }

    #[test]
    fn parses_cli_output() {
        assert_eq!(
            parse_version("2.1.272 (Claude Code)\n").as_deref(),
            Some("2.1.272")
        );
        assert_eq!(parse_version(""), None);
        assert_eq!(
            parse_logged_in(r#"{ "loggedIn": true, "email": "x@y.z" }"#),
            Some(true)
        );
        assert_eq!(parse_logged_in(r#"{"loggedIn":false}"#), Some(false));
        assert_eq!(parse_logged_in("Not logged in"), None);
    }
}
