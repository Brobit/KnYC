//! Where the pipeline host may touch the disk (#55). The host commands give the page file and process
//! access, so every path is checked here:
//! - writes, git and command runs only under the app's data folder (sandboxes, timelines, caches);
//! - reads there too, and in source folders the learner picked in a native dialog.
//!
//! Paths come from the pipeline as absolute paths. `..` is refused outright, and the part of the
//! path that exists is resolved, so a symlink can't lead outside either.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum ScopeError {
    NotAbsolute(String),
    Outside(String),
    Io(String),
}

impl fmt::Display for ScopeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAbsolute(path) => write!(f, "the pipeline only uses absolute paths: {path}"),
            Self::Outside(path) => write!(
                f,
                "{path} is outside the KnYC data folder and the project folders you picked"
            ),
            Self::Io(message) => f.write_str(message),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PipelineScope {
    data: PathBuf,
    sources: Vec<PathBuf>,
}

impl PipelineScope {
    /// `data`: the app's data folder (created when missing).
    pub fn new(data: &Path) -> io::Result<Self> {
        fs::create_dir_all(data)?;
        Ok(Self {
            data: dunce::canonicalize(data)?,
            sources: Vec::new(),
        })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data
    }

    /// Lets the pipeline read `folder` (a project the learner picked in the dialog).
    pub fn add_source(&mut self, folder: &Path) -> Result<PathBuf, ScopeError> {
        let real = dunce::canonicalize(folder).map_err(|e| ScopeError::Io(e.to_string()))?;
        if !real.is_dir() {
            return Err(ScopeError::Io(format!(
                "{} is not a folder",
                folder.display()
            )));
        }
        if !self.sources.contains(&real) {
            self.sources.push(real.clone());
        }
        Ok(real)
    }

    /// The app's data folder.
    pub fn data(&self) -> &Path {
        &self.data
    }

    /// A path the pipeline may write, run git or commands in: inside the data folder.
    pub fn writable(&self, path: &str) -> Result<PathBuf, ScopeError> {
        resolve(path, std::slice::from_ref(&self.data))
    }

    /// A path the pipeline may read: inside the data folder or a picked source.
    pub fn readable(&self, path: &str) -> Result<PathBuf, ScopeError> {
        let mut roots = self.sources.clone();
        roots.push(self.data.clone());
        resolve(path, &roots)
    }
}

/// The real path of `path` (its existing part resolved, the rest appended), if it is inside one of
/// the `roots` (already canonical).
fn resolve(path: &str, roots: &[PathBuf]) -> Result<PathBuf, ScopeError> {
    let given = Path::new(path);
    if !given.is_absolute() {
        return Err(ScopeError::NotAbsolute(path.to_string()));
    }
    if given.components().any(|c| c == Component::ParentDir) {
        return Err(ScopeError::Outside(path.to_string()));
    }
    // Walk up to the nearest part that exists; the rest will be created by the caller.
    let mut existing = given;
    let mut missing = Vec::new();
    while existing.symlink_metadata().is_err() {
        let (Some(name), Some(parent)) = (existing.file_name(), existing.parent()) else {
            return Err(ScopeError::Outside(path.to_string()));
        };
        missing.push(name);
        existing = parent;
    }
    let mut real = dunce::canonicalize(existing).map_err(|e| ScopeError::Io(e.to_string()))?;
    real.extend(missing.into_iter().rev());
    if roots.iter().any(|root| real.starts_with(root)) {
        Ok(real)
    } else {
        Err(ScopeError::Outside(path.to_string()))
    }
}

/// The git commands the pipeline runs (timeline, checks, step checkout), and nothing else: the
/// subcommand comes first (no global option such as `-C` or `-c`), and `config` only sets the
/// identity and line endings (no `core.hooksPath`, `core.fsmonitor`… that would run programs).
pub fn check_git_args(args: &[String]) -> Result<(), String> {
    const SUBCOMMANDS: &[&str] = &[
        "init",
        "config",
        "add",
        "commit",
        "tag",
        "rev-parse",
        "checkout",
        "clean",
        "diff",
        "show",
        "ls-tree",
    ];
    const CONFIG_KEYS: &[&str] = &["user.name", "user.email", "core.autocrlf"];
    let Some(subcommand) = args.first() else {
        return Err("git needs a subcommand".into());
    };
    if !SUBCOMMANDS.contains(&subcommand.as_str()) {
        return Err(format!("git {subcommand} is not allowed for the pipeline"));
    }
    if subcommand == "config" {
        match args.get(1..) {
            Some([key, _value]) if CONFIG_KEYS.contains(&key.as_str()) => {}
            _ => return Err(format!("git config {} is not allowed", args[1..].join(" "))),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PipelineScope, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let source = dir.path().join("my-project");
        fs::create_dir_all(source.join("src")).unwrap();
        fs::write(source.join("src/app.ts"), "export {};").unwrap();
        let scope = PipelineScope::new(&data).unwrap();
        (dir, scope, source)
    }

    fn s(path: &Path) -> String {
        path.display().to_string()
    }

    #[test]
    fn writes_only_inside_the_data_folder() {
        let (dir, scope, source) = setup();
        let data = scope.data_dir().to_path_buf();
        // Not created yet: still inside.
        let nested = data.join("cache/abc/timeline/s01.json");
        assert_eq!(scope.writable(&s(&nested)).unwrap(), nested);
        // Mixed separators, as joinPath builds them on Windows.
        let mixed = format!("{}/cache/x.json", data.display());
        assert!(scope.writable(&mixed).is_ok());

        for outside in [
            s(&source.join("src/app.ts")),
            s(&dir.path().join("elsewhere.txt")),
            s(&dir.path().join("data-other/x")),
            format!("{}/../escape.txt", data.display()),
        ] {
            assert_eq!(
                scope.writable(&outside),
                Err(ScopeError::Outside(outside.clone()))
            );
        }
        assert!(matches!(
            scope.writable("cache/x.json"),
            Err(ScopeError::NotAbsolute(_))
        ));
    }

    #[test]
    fn reads_picked_sources_but_never_writes_them() {
        let (_dir, mut scope, source) = setup();
        let file = s(&source.join("src/app.ts"));
        assert!(matches!(scope.readable(&file), Err(ScopeError::Outside(_))));
        scope.add_source(&source).unwrap();
        assert!(scope.readable(&file).is_ok());
        assert!(matches!(scope.writable(&file), Err(ScopeError::Outside(_))));
        // Picking the same folder twice keeps one entry.
        scope.add_source(&source).unwrap();
        assert_eq!(scope.sources.len(), 1);
        assert!(scope.add_source(&source.join("src/app.ts")).is_err());
    }

    fn symlink_dir(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        return std::os::unix::fs::symlink(target, link).is_ok();
        #[cfg(windows)]
        return std::os::windows::fs::symlink_dir(target, link).is_ok();
    }

    #[test]
    fn symlinks_cannot_lead_outside() {
        let (dir, scope, _) = setup();
        let link = scope.data_dir().join("escape");
        if !symlink_dir(dir.path(), &link) {
            eprintln!("skipped: this account cannot create symlinks");
            return;
        }
        let through = s(&link.join("elsewhere.txt"));
        assert_eq!(
            scope.writable(&through),
            Err(ScopeError::Outside(through.clone()))
        );
        assert!(matches!(
            scope.readable(&through),
            Err(ScopeError::Outside(_))
        ));
    }

    #[test]
    fn only_the_pipelines_git_commands() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        for allowed in [
            &["init", "-q"][..],
            &["config", "user.email", "knyc@localhost"],
            &["commit", "-q", "--allow-empty", "-m", "s01"],
            &["diff", "--name-only", "a", "b", "--", "src/app.ts"],
            &["show", "s01:src/app.ts"],
            &["checkout", "-q", "-f", "s02"],
        ] {
            assert_eq!(check_git_args(&args(allowed)), Ok(()), "{allowed:?}");
        }
        for refused in [
            &[][..],
            &["-C", "/elsewhere", "status"],
            &["-c", "core.hooksPath=/tmp/x", "commit"],
            &["push", "origin"],
            &["config", "core.hooksPath", "/tmp/x"],
            &["config", "--global", "user.name", "x"],
        ] {
            assert!(check_git_args(&args(refused)).is_err(), "{refused:?}");
        }
    }
}
