//! Stage ①: copy the project into a private sandbox. The source folder is never modified;
//! dependencies are installed and builds run in the sandbox.

use crate::secrets::SecretLine;
use crate::walk::{Excluded, Walk, walk};
use anyhow::{Context, bail};
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakeReport {
    pub source: String,
    pub sandbox: String,
    /// Content hash of every copied file (paths + bytes). Keys the analysis cache.
    pub hash: String,
    pub files_copied: usize,
    pub files_for_ai: usize,
    pub excluded: Vec<Excluded>,
    pub secret_lines: Vec<SecretLine>,
}

/// Hash of the project as KnYC sees it: walked files only, in path order.
pub fn source_hash(walk: &Walk) -> anyhow::Result<String> {
    let mut hasher = blake3::Hasher::new();
    for file in &walk.files {
        hasher.update(file.path.as_bytes());
        hasher.update(&[0]);
        hasher.update(&fs::read(&file.abs)?);
        hasher.update(&[0]);
    }
    Ok(format!("blake3:{}", hasher.finalize().to_hex()))
}

/// Copies `source` into `sandbox`, which must not exist yet or be empty.
pub fn intake(source: &Path, sandbox: &Path) -> anyhow::Result<IntakeReport> {
    if sandbox.exists() && fs::read_dir(sandbox)?.next().is_some() {
        bail!("sandbox {} is not empty", sandbox.display());
    }
    let source =
        dunce::canonicalize(source).with_context(|| format!("cannot open {}", source.display()))?;
    fs::create_dir_all(sandbox)?;
    let sandbox = dunce::canonicalize(sandbox)?;
    if sandbox.starts_with(&source) {
        bail!("the sandbox must be outside the source folder");
    }

    let walked = walk(&source)?;
    for file in &walked.files {
        let target = sandbox.join(&file.path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&file.abs, &target).with_context(|| format!("copying {}", file.path))?;
    }

    Ok(IntakeReport {
        source: source.to_string_lossy().into_owned(),
        sandbox: sandbox.to_string_lossy().into_owned(),
        hash: source_hash(&walked)?,
        files_copied: walked.files.len(),
        files_for_ai: walked.ai_files().count(),
        excluded: walked.excluded,
        secret_lines: walked.secret_lines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_everything_but_secrets_and_ignored_folders() {
        let src = tempfile::tempdir().unwrap();
        let r = src.path();
        fs::create_dir_all(r.join("src")).unwrap();
        fs::create_dir_all(r.join("node_modules/x")).unwrap();
        fs::write(r.join("src/app.ts"), "export {};\n").unwrap();
        fs::write(r.join("node_modules/x/index.js"), "x\n").unwrap();
        fs::write(r.join(".env"), "SECRET=1\n").unwrap();

        let out = tempfile::tempdir().unwrap();
        let sandbox = out.path().join("sandbox");
        let report = intake(r, &sandbox).unwrap();

        assert_eq!(report.files_copied, 1);
        assert!(sandbox.join("src/app.ts").exists());
        assert!(!sandbox.join(".env").exists());
        assert!(!sandbox.join("node_modules").exists());
        assert!(report.hash.starts_with("blake3:"));
        // Source untouched.
        assert!(r.join(".env").exists());
    }

    #[test]
    fn same_content_same_hash() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        for dir in [a.path(), b.path()] {
            fs::write(dir.join("main.ts"), "console.log(1);\n").unwrap();
        }
        let hash = |p: &Path| source_hash(&walk(p).unwrap()).unwrap();
        assert_eq!(hash(a.path()), hash(b.path()));
        fs::write(b.path().join("main.ts"), "console.log(2);\n").unwrap();
        assert_ne!(hash(a.path()), hash(b.path()));
    }

    #[test]
    fn refuses_a_non_empty_sandbox_or_one_inside_the_source() {
        let src = tempfile::tempdir().unwrap();
        fs::write(src.path().join("a.ts"), "1\n").unwrap();
        assert!(intake(src.path(), &src.path().join("sandbox")).is_err());

        let out = tempfile::tempdir().unwrap();
        fs::write(out.path().join("existing"), "x").unwrap();
        assert!(intake(src.path(), out.path()).is_err());
    }
}
