//! File operations confined to the opened workspace folder. Every path from the UI is relative
//! ("src/app.ts", "/" separators) and goes through [`Scope::resolve`], which refuses absolute
//! paths, `..`, and anything that leaves the folder through a symlink.

use ignore::WalkBuilder;
use knyc_analyzer::walk::IGNORED_DIRS;
use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

/// The editor opens text files up to this size; bigger ones are shown as "too large".
pub const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
/// Suffix of the temporary file used for atomic saves; the watcher ignores it.
pub const TMP_SUFFIX: &str = ".knyc-tmp";

/// Errors the UI can tell apart; `message` is for logs and tooltips.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum FsError {
    NoWorkspace(String),
    OutsideWorkspace(String),
    NotFound(String),
    AlreadyExists(String),
    NotText(String),
    TooLarge(String),
    Io(String),
}

impl FsError {
    fn io(path: &str, error: std::io::Error) -> Self {
        match error.kind() {
            ErrorKind::NotFound => Self::NotFound(path.to_string()),
            ErrorKind::AlreadyExists => Self::AlreadyExists(path.to_string()),
            _ => Self::Io(format!("{path}: {error}")),
        }
    }
}

pub type FsResult<T> = Result<T, FsError>;

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TreeEntry {
    /// Relative to the workspace root, "/" separators.
    pub path: String,
    pub kind: EntryKind,
}

#[derive(Debug, Clone)]
pub struct Scope {
    root: PathBuf,
}

impl Scope {
    /// Opens `root`, which must be an existing folder.
    pub fn new(root: &Path) -> FsResult<Self> {
        let shown = root.display().to_string();
        let root = dunce::canonicalize(root).map_err(|e| FsError::io(&shown, e))?;
        if !root.is_dir() {
            return Err(FsError::NotFound(shown));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Maps a relative path to a path inside the workspace, or refuses it. The path itself may
    /// not exist yet (create, rename target), but its parent must, and both must resolve inside.
    pub fn resolve(&self, rel: &str) -> FsResult<PathBuf> {
        let outside = || FsError::OutsideWorkspace(rel.to_string());
        let mut path = self.root.clone();
        for component in Path::new(rel).components() {
            match component {
                Component::Normal(part) => path.push(part),
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err(outside());
                }
            }
        }
        // Follow symlinks on whatever exists: the path itself, else its parent folder.
        let existing = if path.symlink_metadata().is_ok() {
            path.as_path()
        } else {
            path.parent().ok_or_else(outside)?
        };
        let real = dunce::canonicalize(existing).map_err(|e| FsError::io(rel, e))?;
        if real.starts_with(&self.root) {
            Ok(path)
        } else {
            Err(outside())
        }
    }

    /// Like [`resolve`](Self::resolve), but the workspace folder itself is refused.
    fn resolve_child(&self, rel: &str) -> FsResult<PathBuf> {
        let path = self.resolve(rel)?;
        if path == self.root {
            Err(FsError::OutsideWorkspace(rel.to_string()))
        } else {
            Ok(path)
        }
    }

    pub fn relative(&self, path: &Path) -> Option<String> {
        let rel = path.strip_prefix(&self.root).ok()?;
        let parts: Vec<_> = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect();
        Some(parts.join("/"))
    }

    /// Every file and folder, with the same ignore rules as knyc-analyzer: .gitignore files
    /// and [`IGNORED_DIRS`]. Symlinks are listed but not followed.
    pub fn tree(&self) -> FsResult<Vec<TreeEntry>> {
        self.walk(&self.root, None)
    }

    /// The direct children of one folder ("" for the root), with the same rules as [`tree`](Self::tree).
    /// The Explorer loads folders this way, one level at a time, as they are expanded.
    pub fn list(&self, rel: &str) -> FsResult<Vec<TreeEntry>> {
        let dir = self.resolve(rel)?;
        if !dir.is_dir() {
            return Err(FsError::NotFound(rel.to_string()));
        }
        self.walk(&dir, Some(1))
    }

    fn walk(&self, from: &Path, max_depth: Option<usize>) -> FsResult<Vec<TreeEntry>> {
        let walker = WalkBuilder::new(from)
            .hidden(false)
            .require_git(false)
            .follow_links(false)
            .max_depth(max_depth)
            .sort_by_file_name(|a, b| a.cmp(b))
            .filter_entry(|entry| {
                let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
                !(is_dir
                    && entry.depth() > 0
                    && IGNORED_DIRS.contains(&entry.file_name().to_string_lossy().as_ref()))
            })
            .build();
        let mut entries = Vec::new();
        for entry in walker {
            let entry = entry.map_err(|e| FsError::Io(e.to_string()))?;
            if entry.depth() == 0 {
                continue;
            }
            let Some(file_type) = entry.file_type() else {
                continue;
            };
            let kind = if file_type.is_symlink() {
                EntryKind::Symlink
            } else if file_type.is_dir() {
                EntryKind::Dir
            } else {
                EntryKind::File
            };
            if let Some(path) = self.relative(entry.path()) {
                entries.push(TreeEntry { path, kind });
            }
        }
        Ok(entries)
    }

    pub fn read_text(&self, rel: &str) -> FsResult<String> {
        let path = self.resolve_child(rel)?;
        let size = fs::metadata(&path).map_err(|e| FsError::io(rel, e))?.len();
        if size > MAX_TEXT_BYTES {
            return Err(FsError::TooLarge(rel.to_string()));
        }
        let bytes = fs::read(&path).map_err(|e| FsError::io(rel, e))?;
        String::from_utf8(bytes).map_err(|_| FsError::NotText(rel.to_string()))
    }

    /// Saves through a temporary file and a rename, so a crash never leaves half a file.
    pub fn write_text(&self, rel: &str, content: &str) -> FsResult<()> {
        let path = self.resolve_child(rel)?;
        if path.is_dir() {
            return Err(FsError::AlreadyExists(rel.to_string()));
        }
        let mut tmp = path.clone().into_os_string();
        tmp.push(TMP_SUFFIX);
        fs::write(&tmp, content).map_err(|e| FsError::io(rel, e))?;
        fs::rename(&tmp, &path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            FsError::io(rel, e)
        })
    }

    pub fn create_file(&self, rel: &str) -> FsResult<()> {
        let path = self.resolve_child(rel)?;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map(|_| ())
            .map_err(|e| FsError::io(rel, e))
    }

    pub fn create_dir(&self, rel: &str) -> FsResult<()> {
        let path = self.resolve_child(rel)?;
        fs::create_dir(&path).map_err(|e| FsError::io(rel, e))
    }

    /// Moves a file or folder; the target must not exist.
    pub fn rename(&self, from: &str, to: &str) -> FsResult<()> {
        let source = self.resolve_child(from)?;
        let target = self.resolve_child(to)?;
        source
            .symlink_metadata()
            .map_err(|e| FsError::io(from, e))?;
        if target.symlink_metadata().is_ok() {
            return Err(FsError::AlreadyExists(to.to_string()));
        }
        if target.starts_with(&source) {
            return Err(FsError::Io(format!("cannot move {from} into itself")));
        }
        fs::rename(&source, &target).map_err(|e| FsError::io(from, e))
    }

    /// Deletes a file, a folder with its content, or a symlink (never what it points to).
    pub fn delete(&self, rel: &str) -> FsResult<()> {
        let path = self.resolve_child(rel)?;
        let meta = path.symlink_metadata().map_err(|e| FsError::io(rel, e))?;
        let result = if meta.is_symlink() {
            // A link to a folder is a directory entry on Windows.
            fs::remove_file(&path).or_else(|_| fs::remove_dir(&path))
        } else if meta.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        result.map_err(|e| FsError::io(rel, e))
    }
}

/// True for paths the watcher should not report: ignored folders and our own temporary files.
pub fn is_noise(rel: &str) -> bool {
    rel.ends_with(TMP_SUFFIX) || rel.split('/').any(|part| IGNORED_DIRS.contains(&part))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (tempfile::TempDir, Scope) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/app.ts"), "export const app = 1;\n").unwrap();
        fs::write(dir.path().join("secret.txt"), "outside").unwrap();
        let scope = Scope::new(&root).unwrap();
        (dir, scope)
    }

    fn outside(rel: &str) -> FsError {
        FsError::OutsideWorkspace(rel.to_string())
    }

    #[test]
    fn refuses_parent_and_absolute_paths() {
        let (dir, scope) = workspace();
        assert_eq!(
            scope.read_text("../secret.txt"),
            Err(outside("../secret.txt"))
        );
        assert_eq!(
            scope.read_text("src/../../secret.txt"),
            Err(outside("src/../../secret.txt"))
        );
        let absolute = dir.path().join("secret.txt").display().to_string();
        assert_eq!(scope.read_text(&absolute), Err(outside(&absolute)));
        assert_eq!(
            scope.write_text("../evil.txt", "x"),
            Err(outside("../evil.txt"))
        );
        assert!(!dir.path().join("evil.txt").exists());
    }

    #[test]
    fn refuses_the_workspace_folder_itself() {
        let (_dir, scope) = workspace();
        assert_eq!(scope.delete(""), Err(outside("")));
        assert_eq!(scope.delete("."), Err(outside(".")));
        assert_eq!(scope.rename("", "moved"), Err(outside("")));
        assert!(scope.root().exists());
    }

    #[test]
    fn reads_writes_and_saves_atomically() {
        let (_dir, scope) = workspace();
        assert_eq!(
            scope.read_text("src/app.ts").unwrap(),
            "export const app = 1;\n"
        );
        scope
            .write_text("src/app.ts", "export const app = 2;\n")
            .unwrap();
        assert_eq!(
            scope.read_text("./src/app.ts").unwrap(),
            "export const app = 2;\n"
        );
        assert!(!scope.root().join("src/app.ts.knyc-tmp").exists());
        // Saving a new file in an existing folder creates it; a missing folder is not created.
        scope.write_text("src/new.ts", "").unwrap();
        assert_eq!(
            scope.write_text("lib/new.ts", ""),
            Err(FsError::NotFound("lib/new.ts".into()))
        );
    }

    #[test]
    fn reports_binary_large_and_missing_files() {
        let (_dir, scope) = workspace();
        fs::write(
            scope.root().join("logo.png"),
            [0x89, b'P', b'N', b'G', 0xff, 0xfe],
        )
        .unwrap();
        assert_eq!(
            scope.read_text("logo.png"),
            Err(FsError::NotText("logo.png".into()))
        );
        let big = fs::File::create(scope.root().join("big.log")).unwrap();
        big.set_len(MAX_TEXT_BYTES + 1).unwrap();
        assert_eq!(
            scope.read_text("big.log"),
            Err(FsError::TooLarge("big.log".into()))
        );
        assert_eq!(
            scope.read_text("nope.ts"),
            Err(FsError::NotFound("nope.ts".into()))
        );
    }

    #[test]
    fn creates_renames_and_deletes() {
        let (_dir, scope) = workspace();
        scope.create_dir("src/auth").unwrap();
        scope.create_file("src/auth/guard.ts").unwrap();
        assert_eq!(
            scope.create_file("src/auth/guard.ts"),
            Err(FsError::AlreadyExists("src/auth/guard.ts".into()))
        );
        assert_eq!(
            scope.create_dir("src/auth"),
            Err(FsError::AlreadyExists("src/auth".into()))
        );

        scope
            .rename("src/auth/guard.ts", "src/auth/jwt.guard.ts")
            .unwrap();
        assert_eq!(
            scope.rename("src/app.ts", "src/auth/jwt.guard.ts"),
            Err(FsError::AlreadyExists("src/auth/jwt.guard.ts".into()))
        );
        assert_eq!(
            scope.rename("src", "src/auth/src"),
            Err(FsError::Io("cannot move src into itself".into()))
        );
        assert_eq!(
            scope.rename("src/app.ts", "../app.ts"),
            Err(outside("../app.ts"))
        );

        scope.delete("src/auth").unwrap();
        assert!(!scope.root().join("src/auth").exists());
        scope.delete("src/app.ts").unwrap();
        assert_eq!(
            scope.delete("src/app.ts"),
            Err(FsError::NotFound("src/app.ts".into()))
        );
    }

    #[test]
    fn tree_uses_the_analyzer_ignore_rules() {
        let (_dir, scope) = workspace();
        let root = scope.root();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "").unwrap();
        fs::create_dir_all(root.join("generated")).unwrap();
        fs::write(root.join("generated/x.ts"), "").unwrap();
        fs::write(root.join(".gitignore"), "generated/\n").unwrap();
        fs::write(root.join(".env.example"), "PORT=3000\n").unwrap();

        let paths: Vec<_> = scope
            .tree()
            .unwrap()
            .into_iter()
            .map(|e| (e.path, e.kind))
            .collect();
        assert_eq!(
            paths,
            vec![
                (".env.example".into(), EntryKind::File),
                (".gitignore".into(), EntryKind::File),
                ("src".into(), EntryKind::Dir),
                ("src/app.ts".into(), EntryKind::File),
            ]
        );
    }

    #[test]
    fn lists_one_folder_at_a_time() {
        let (_dir, scope) = workspace();
        let root = scope.root();
        fs::create_dir_all(root.join("src/auth")).unwrap();
        fs::write(root.join("src/auth/guard.ts"), "").unwrap();
        fs::create_dir_all(root.join("src/node_modules")).unwrap();
        fs::write(root.join("src/.gitignore"), "*.log\n").unwrap();
        fs::write(root.join("src/debug.log"), "").unwrap();

        let names = |rel: &str| -> Vec<(String, EntryKind)> {
            scope
                .list(rel)
                .unwrap()
                .into_iter()
                .map(|e| (e.path, e.kind))
                .collect()
        };
        assert_eq!(names(""), vec![("src".into(), EntryKind::Dir)]);
        assert_eq!(
            names("src"),
            vec![
                ("src/.gitignore".into(), EntryKind::File),
                ("src/app.ts".into(), EntryKind::File),
                ("src/auth".into(), EntryKind::Dir),
            ]
        );
        assert_eq!(
            scope.list("src/app.ts"),
            Err(FsError::NotFound("src/app.ts".into()))
        );
        assert_eq!(scope.list(".."), Err(outside("..")));
    }

    #[test]
    fn noise_filter() {
        assert!(is_noise("node_modules/a/b.js"));
        assert!(is_noise("src/app.ts.knyc-tmp"));
        assert!(is_noise(".git/index"));
        assert!(!is_noise("src/app.ts"));
    }

    fn symlink(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        return std::os::unix::fs::symlink(target, link).is_ok();
        #[cfg(windows)]
        return if target.is_dir() {
            std::os::windows::fs::symlink_dir(target, link).is_ok()
        } else {
            std::os::windows::fs::symlink_file(target, link).is_ok()
        };
    }

    #[test]
    fn refuses_symlinks_that_leave_the_workspace() {
        let (dir, scope) = workspace();
        let root = scope.root();
        // Windows only allows symlinks with developer mode or admin rights; CI covers Unix.
        if !symlink(&dir.path().join("secret.txt"), &root.join("link.txt")) {
            eprintln!("skipped: this account cannot create symlinks");
            return;
        }
        assert!(symlink(dir.path(), &root.join("escape")));
        assert!(symlink(&root.join("src/app.ts"), &root.join("inside.ts")));

        assert_eq!(scope.read_text("link.txt"), Err(outside("link.txt")));
        assert_eq!(
            scope.read_text("escape/secret.txt"),
            Err(outside("escape/secret.txt"))
        );
        assert_eq!(
            scope.write_text("escape/new.txt", "x"),
            Err(outside("escape/new.txt"))
        );
        assert_eq!(
            scope.create_file("escape/new.txt"),
            Err(outside("escape/new.txt"))
        );
        assert!(!dir.path().join("new.txt").exists());
        // A link that stays inside works, and the tree lists links without following them.
        assert_eq!(
            scope.read_text("inside.ts").unwrap(),
            "export const app = 1;\n"
        );
        let tree = scope.tree().unwrap();
        assert!(tree.contains(&TreeEntry {
            path: "escape".into(),
            kind: EntryKind::Symlink
        }));
        assert!(!tree.iter().any(|e| e.path.starts_with("escape/")));
    }
}
