//! Walks a project and classifies every file: skipped (ignored folder or secret), kept for the
//! sandbox only (binary, too large, lockfile), or kept and readable by the AI.

use crate::rel_path;
use crate::secrets::{SecretLine, find_secret_lines, is_secret_file};
use ignore::WalkBuilder;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Folders that are never part of the source, whatever .gitignore says.
pub const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".astro",
    ".turbo",
    ".cache",
    "coverage",
    "target",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".pytest_cache",
    ".mypy_cache",
    "bin",
    "obj",
    ".idea",
    ".vscode",
    ".knyc",
];

const LOCKFILES: &[&str] = &[
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "bun.lock",
    "poetry.lock",
    "Pipfile.lock",
    "uv.lock",
    "go.sum",
    "Cargo.lock",
    "packages.lock.json",
];

/// Files above this size are kept for builds but never sent to the AI.
pub const MAX_AI_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NotForAi {
    Binary,
    TooLarge,
    Lockfile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExcludedReason {
    Secret,
    Ignored,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkedFile {
    pub path: String,
    #[serde(skip)]
    pub abs: PathBuf,
    pub bytes: u64,
    /// Line count for text files, 0 for binaries.
    pub lines: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_for_ai: Option<NotForAi>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Excluded {
    pub path: String,
    pub reason: ExcludedReason,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Walk {
    pub files: Vec<WalkedFile>,
    pub excluded: Vec<Excluded>,
    pub secret_lines: Vec<SecretLine>,
}

impl Walk {
    pub fn ai_files(&self) -> impl Iterator<Item = &WalkedFile> {
        self.files.iter().filter(|f| f.not_for_ai.is_none())
    }

    pub fn has(&self, path: &str) -> bool {
        self.files.iter().any(|f| f.path == path)
    }
}

/// Walks `root`, respecting .gitignore files and [`IGNORED_DIRS`]. Hidden files are included
/// (`.github/`, `.env.example`…), so the secret guard sees them.
pub fn walk(root: &Path) -> anyhow::Result<Walk> {
    let root = dunce::canonicalize(root)?;
    let walker = WalkBuilder::new(&root)
        .hidden(false)
        // .gitignore files apply even outside a git repository.
        .require_git(false)
        .sort_by_file_name(|a, b| a.cmp(b))
        .filter_entry(|entry| {
            let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
            !(is_dir
                && entry.depth() > 0
                && IGNORED_DIRS.contains(&entry.file_name().to_string_lossy().as_ref()))
        })
        .build();

    let mut result = Walk::default();
    // Reported from what is on disk: a .gitignore may hide these folders before filter_entry
    // ever sees them, but the user should still know they were left out.
    let mut ignored_dirs = Vec::new();
    for entry in walker {
        let entry = entry?;
        if entry.file_type().is_some_and(|t| t.is_dir()) {
            for name in IGNORED_DIRS {
                let candidate = entry.path().join(name);
                if candidate.is_dir() {
                    ignored_dirs.push(rel_path(&root, &candidate));
                }
            }
            continue;
        }
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = rel_path(&root, entry.path());
        let name = entry.file_name().to_string_lossy();
        if is_secret_file(&name) {
            result.excluded.push(Excluded {
                path,
                reason: ExcludedReason::Secret,
            });
            continue;
        }

        let bytes = entry.metadata()?.len();
        let content = std::fs::read(entry.path())?;
        let is_binary = content.iter().take(8000).any(|&b| b == 0);
        let lines = if is_binary {
            0
        } else {
            content.iter().filter(|&&b| b == b'\n').count()
                + usize::from(!content.is_empty() && content.last() != Some(&b'\n'))
        };

        let not_for_ai = if is_binary {
            Some(NotForAi::Binary)
        } else if LOCKFILES.contains(&name.as_ref()) {
            Some(NotForAi::Lockfile)
        } else if bytes > MAX_AI_FILE_BYTES {
            Some(NotForAi::TooLarge)
        } else {
            None
        };
        if not_for_ai.is_none() {
            result
                .secret_lines
                .extend(find_secret_lines(&path, &String::from_utf8_lossy(&content)));
        }

        result.files.push(WalkedFile {
            path,
            abs: entry.into_path(),
            bytes,
            lines,
            not_for_ai,
        });
    }

    ignored_dirs.sort();
    result
        .excluded
        .extend(ignored_dirs.into_iter().map(|path| Excluded {
            path: format!("{path}/"),
            reason: ExcludedReason::Ignored,
        }));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, path: &str, content: &[u8]) {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }

    fn project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "package.json", b"{}\n");
        write(r, "package-lock.json", b"{}\n");
        write(
            r,
            "src/app.ts",
            b"export const a = 1;\nexport const b = 2;\n",
        );
        write(
            r,
            "src/config.ts",
            b"const url = \"postgres://app:supersecret@db/app\";\n",
        );
        write(
            r,
            "node_modules/express/index.js",
            b"module.exports = {};\n",
        );
        write(r, "dist/app.js", b"compiled\n");
        write(r, ".env", b"JWT_SECRET=abc\n");
        write(r, ".env.example", b"JWT_SECRET=\n");
        write(r, "certs/server.key", b"key\n");
        write(r, "assets/logo.png", &[0x89, b'P', b'N', b'G', 0, 0, 1]);
        // A .gitignore that also hides an always-ignored folder: it must still be reported.
        write(r, ".gitignore", b"generated/\ncoverage/\n");
        write(r, "coverage/index.html", b"<html></html>\n");
        write(r, "generated/types.ts", b"export {};\n");
        write(r, ".github/workflows/ci.yml", b"name: CI\n");
        dir
    }

    #[test]
    fn classifies_files() {
        let dir = project();
        let w = walk(dir.path()).unwrap();
        let paths: Vec<_> = w.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                ".env.example",
                ".github/workflows/ci.yml",
                ".gitignore",
                "assets/logo.png",
                "package-lock.json",
                "package.json",
                "src/app.ts",
                "src/config.ts",
            ]
        );

        let excluded: Vec<_> = w
            .excluded
            .iter()
            .map(|e| (e.path.as_str(), e.reason))
            .collect();
        assert!(excluded.contains(&(".env", ExcludedReason::Secret)));
        assert!(excluded.contains(&("certs/server.key", ExcludedReason::Secret)));
        assert!(excluded.contains(&("node_modules/", ExcludedReason::Ignored)));
        assert!(excluded.contains(&("dist/", ExcludedReason::Ignored)));
        assert!(excluded.contains(&("coverage/", ExcludedReason::Ignored)));

        let file = |p: &str| w.files.iter().find(|f| f.path == p).unwrap();
        assert_eq!(file("assets/logo.png").not_for_ai, Some(NotForAi::Binary));
        assert_eq!(
            file("package-lock.json").not_for_ai,
            Some(NotForAi::Lockfile)
        );
        assert_eq!(file("src/app.ts").lines, 2);
        assert_eq!(file("src/app.ts").not_for_ai, None);
        assert_eq!(w.ai_files().count(), 6);

        assert_eq!(w.secret_lines.len(), 1);
        assert_eq!(w.secret_lines[0].path, "src/config.ts");
        assert_eq!(w.secret_lines[0].line, 1);
    }

    #[test]
    fn large_files_are_kept_but_not_for_ai() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "data/big.json",
            &vec![b'a'; (MAX_AI_FILE_BYTES + 1) as usize],
        );
        let w = walk(dir.path()).unwrap();
        assert_eq!(w.files[0].not_for_ai, Some(NotForAi::TooLarge));
    }
}
