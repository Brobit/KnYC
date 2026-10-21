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

#[test]
fn express_notes_layers_match_its_readme() {
    let g = knyc_analyzer::graph::build(&golden("express-notes")).unwrap();
    assert_eq!(
        g.layers,
        vec![
            vec!["src/config.ts", "src/errors.ts", "src/notes/note.ts"],
            vec!["src/notes/notes.store.ts", "src/notes/notes.validation.ts"],
            vec!["src/notes/notes.routes.ts"],
            vec!["src/app.ts"],
            vec!["src/server.ts"],
        ]
    );
    assert!(g.symbol_edges.contains(&(
        "src/notes/notes.routes.ts#notesRouter".into(),
        "src/notes/notes.validation.ts#parseNoteInput".into()
    )));
}

#[test]
fn every_golden_repo_has_a_clean_graph_ending_at_the_server() {
    for name in ["express-notes", "express-shop", "express-no-tests"] {
        let g = knyc_analyzer::graph::build(&golden(name)).unwrap();
        assert!(g.cycles.is_empty(), "{name}");
        assert!(g.unresolved.is_empty(), "{name}");
        assert!(g.files.iter().all(|f| !f.parse_errors), "{name}");
        let n = g.layers.len();
        assert_eq!(g.layers[n - 1], vec!["src/server.ts"], "{name}");
        assert_eq!(g.layers[n - 2], vec!["src/app.ts"], "{name}");
        assert!(g.external.contains_key("express"), "{name}");
    }
}

#[test]
fn method_calls_through_injected_services_are_dependencies() {
    let g = knyc_analyzer::graph::build(&golden("express-shop")).unwrap();
    let has = |from: &str, to: &str| g.symbol_edges.contains(&(from.to_string(), to.to_string()));
    // this.products.reserveStock(lines) inside checkout
    assert!(has(
        "src/orders/orders.service.ts#OrdersService.checkout",
        "src/products/products.service.ts#ProductsService.reserveStock"
    ));
    // this.getForUser(…) inside changeStatus: a call to a method of the same class
    assert!(has(
        "src/orders/orders.service.ts#OrdersService.changeStatus",
        "src/orders/orders.service.ts#OrdersService.getForUser"
    ));
    // No made-up edges for names that aren't methods of a known class.
    assert!(!g.symbol_edges.iter().any(|(_, to)| to.ends_with(".json")));
}
