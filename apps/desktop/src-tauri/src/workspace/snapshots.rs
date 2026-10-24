//! The learner's snapshots (#65, design/03): `.knyc/snapshots.git`, a repository of its own whose
//! work tree is the workspace, so it never touches the learner's own `.git`. A snapshot commits the
//! learner's code when a step is passed, or before KnYC changes it (skipping a step).

use std::fs;
use std::path::Path;
use std::process::Command;

const GIT_DIR: &str = ".knyc/snapshots.git";
/// Never in a snapshot: what installs and builds make, KnYC's own files. The workspace's
/// `.gitignore` applies too, and git never adds a `.git` folder.
const EXCLUDE: &str = "node_modules/\ndist/\nbuild/\ncoverage/\n.knyc/\n.knyc-*\n";

fn no_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

fn run(command: &mut Command) -> Result<String, String> {
    let output = no_window(command.env("GIT_TERMINAL_PROMPT", "0"))
        .output()
        .map_err(|e| format!("could not start git: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// git on the snapshots repository, with the workspace as its work tree.
fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    run(Command::new("git")
        .arg("--git-dir")
        .arg(root.join(GIT_DIR))
        .arg("--work-tree")
        .arg(root)
        .args(args)
        .current_dir(root))
}

fn init(root: &Path) -> Result<(), String> {
    let dir = root.join(GIT_DIR);
    if dir.join("HEAD").is_file() {
        return Ok(());
    }
    run(Command::new("git")
        .args(["init", "--bare", "-q"])
        .arg(&dir)
        .current_dir(root))?;
    fs::create_dir_all(dir.join("info")).map_err(|e| e.to_string())?;
    fs::write(dir.join("info").join("exclude"), EXCLUDE).map_err(|e| e.to_string())?;
    for (key, value) in [
        ("core.bare", "false"),
        ("core.autocrlf", "false"),
        ("user.name", "KnYC"),
        ("user.email", "knyc@localhost"),
    ] {
        git(root, &["config", key, value])?;
    }
    Ok(())
}

/// Commits the learner's code as it is now; returns the commit.
pub fn snapshot(root: &Path, message: &str) -> Result<String, String> {
    init(root)?;
    git(root, &["add", "-A"])?;
    git(root, &["commit", "-q", "--allow-empty", "-m", message])?;
    git(root, &["rev-parse", "HEAD"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_the_code_without_the_learners_git_or_knyc_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "").unwrap();
        fs::create_dir_all(root.join(".knyc")).unwrap();
        fs::write(root.join(".knyc/progress.json"), "{}").unwrap();
        fs::write(root.join("src/config.ts"), "export const port = 3000;\n").unwrap();

        let first = snapshot(root, "s01 passed").unwrap();
        fs::write(root.join("src/config.ts"), "export const port = 4000;\n").unwrap();
        let second = snapshot(root, "s02 passed").unwrap();
        assert_ne!(first, second);

        let files = git(root, &["ls-tree", "-r", "--name-only", &second]).unwrap();
        assert_eq!(files, "src/config.ts");
        assert_eq!(
            git(root, &["show", &format!("{first}:src/config.ts")]).unwrap(),
            "export const port = 3000;"
        );
        // The learner's own repository is untouched.
        assert_eq!(
            fs::read_to_string(root.join(".git/HEAD")).unwrap(),
            "ref: refs/heads/main\n"
        );
        // Nothing changed since: a snapshot still works (empty commit).
        assert_ne!(snapshot(root, "s03 skipped").unwrap(), second);
    }
}
