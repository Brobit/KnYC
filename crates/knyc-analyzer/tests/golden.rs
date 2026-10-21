//! Scans the golden repos (fixtures/golden) and checks what the pipeline relies on.

use knyc_analyzer::scan::{ScanOptions, scan};
use std::path::PathBuf;

fn golden(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/golden")
        .join(name)
}

const NO_TOOLCHAINS: ScanOptions = ScanOptions {
    detect_toolchains: false,
};

#[test]
fn every_golden_repo_is_an_express_typescript_project() {
    for name in ["express-notes", "express-shop", "express-no-tests"] {
        let s = scan(&golden(name), NO_TOOLCHAINS).unwrap();
        assert_eq!(s.languages[0].id, "typescript", "{name}");
        assert_eq!(s.frameworks.len(), 1, "{name}");
        assert_eq!(s.frameworks[0].profile_id, "express", "{name}");
        let commands = &s.commands[0];
        assert_eq!(commands.install.as_deref(), Some("npm ci"), "{name}");
        assert_eq!(commands.build.as_deref(), Some("npm run build"), "{name}");
        assert_eq!(commands.run.as_deref(), Some("npm run start"), "{name}");
        assert!(s.secret_lines.is_empty(), "{name}");
        // Sources only: no node_modules or dist content, even when installed and built locally.
        assert!(
            s.files.iter().all(|f| f.path.starts_with("src/")
                || f.path.starts_with("tests/")
                || !f.path.contains('/')),
            "{name}"
        );
    }
}

#[test]
fn tests_are_detected_only_where_they_exist() {
    let with_tests = scan(&golden("express-shop"), NO_TOOLCHAINS).unwrap();
    assert_eq!(with_tests.test_runners[0].runner, "vitest");
    assert_eq!(with_tests.commands[0].test.as_deref(), Some("npm run test"));

    let without = scan(&golden("express-no-tests"), NO_TOOLCHAINS).unwrap();
    assert!(without.test_runners.is_empty());
    assert_eq!(without.commands[0].test, None);
}

#[test]
fn lockfile_is_kept_for_builds_but_not_sent_to_the_ai() {
    let s = scan(&golden("express-notes"), NO_TOOLCHAINS).unwrap();
    let lock = s
        .files
        .iter()
        .find(|f| f.path == "package-lock.json")
        .unwrap();
    assert!(lock.not_for_ai.is_some());
}
