//! Reads Jest / Vitest JSON reports (Vitest's `json` reporter uses Jest's format) into a small,
//! stable shape with what a learner (and the AI explaining a failure) needs: which test, where,
//! expected vs received.

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TestStatus {
    Pass,
    Fail,
    Skip,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    /// First line of the assertion error, without the "AssertionError:" prefix.
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual: Option<String>,
    /// Test file location of the failing assertion, relative to the project.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    /// Test file, relative to the project.
    pub file: String,
    /// Describe blocks + title: "/notes returns 400 with details for invalid input".
    pub name: String,
    pub status: TestStatus,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<Failure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    pub success: bool,
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub tests: Vec<TestCase>,
}

/// Normalizes a path from a report ("C:\\x\\y", "file:///C:/x/y") and makes it relative to
/// `root` when it is inside it.
fn relative(path: &str, root: &str) -> String {
    let path = path.trim_start_matches("file://").replace('\\', "/");
    let path = path.trim_start_matches('/');
    let root = root.replace('\\', "/");
    let root = root.trim_start_matches('/').trim_end_matches('/');
    match path.strip_prefix(root) {
        Some(rest) if !root.is_empty() => rest.trim_start_matches('/').to_string(),
        _ => path.to_string(),
    }
}

static CHAI: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^expected (?<actual>.+?) to (?:not )?(?:be|equal|eql|deeply equal|strictly equal|include|contain|match|have length|have property|be above|be below|be at least|be at most) (?<expected>.+?)(?: // .*)?$",
    )
    .expect("valid regex")
});
static JEST_EXPECTED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s*Expected[^:]*:\s*(.+)$").expect("valid regex"));
static JEST_RECEIVED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s*Received[^:]*:\s*(.+)$").expect("valid regex"));
static STACK_LOCATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\(?((?:file:/+)?[^\s()]+?):(\d+):\d+\)?\s*$").expect("valid regex")
});
static ANSI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*m").expect("valid regex"));

pub fn parse_failure(raw: &str, root: &str) -> Failure {
    let raw = ANSI.replace_all(raw, "");
    let first = raw
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();
    let message = first
        .trim_start_matches("AssertionError: ")
        .trim_start_matches("Error: ")
        .to_string();

    let (mut expected, mut actual) = (None, None);
    if let Some(c) = CHAI.captures(&message) {
        expected = Some(c["expected"].to_string());
        actual = Some(c["actual"].to_string());
    } else {
        expected = JEST_EXPECTED
            .captures(&raw)
            .map(|c| c[1].trim().to_string())
            .or(expected);
        actual = JEST_RECEIVED
            .captures(&raw)
            .map(|c| c[1].trim().to_string())
            .or(actual);
    }

    // First stack frame in the project's own code (not node_modules, not Node internals).
    let location = raw
        .lines()
        .filter(|l| l.trim_start().starts_with("at "))
        .filter_map(|l| STACK_LOCATION.captures(l.trim()))
        .map(|c| (relative(&c[1], root), c[2].parse::<u32>().ok()))
        .find(|(file, _)| !file.contains("node_modules") && !file.starts_with("node:"));

    Failure {
        message,
        expected,
        actual,
        file: location.as_ref().map(|(f, _)| f.clone()),
        line: location.and_then(|(_, l)| l),
    }
}

/// Parses a Jest or Vitest JSON report. `root` is the project folder the tests ran in.
pub fn parse_report(json: &str, root: &str) -> anyhow::Result<TestReport> {
    let value: Value = serde_json::from_str(json)?;
    let mut tests = Vec::new();
    for suite in value["testResults"].as_array().into_iter().flatten() {
        let file = relative(suite["name"].as_str().unwrap_or(""), root);
        for t in suite["assertionResults"].as_array().into_iter().flatten() {
            let status = match t["status"].as_str() {
                Some("passed") => TestStatus::Pass,
                Some("failed") => TestStatus::Fail,
                _ => TestStatus::Skip,
            };
            let name = t["fullName"]
                .as_str()
                .or_else(|| t["title"].as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let failure = (status == TestStatus::Fail).then(|| {
                let raw = t["failureMessages"][0].as_str().unwrap_or("");
                parse_failure(raw, root)
            });
            tests.push(TestCase {
                file: file.clone(),
                name,
                status,
                duration_ms: t["duration"].as_f64().unwrap_or(0.0).round() as u64,
                failure,
            });
        }
        // A file that fails to load has no assertion results, only a message.
        let message = suite["message"].as_str().unwrap_or("").trim();
        if suite["status"].as_str() == Some("failed") && !message.is_empty() {
            tests.push(TestCase {
                file: file.clone(),
                name: format!("{file} (could not run)"),
                status: TestStatus::Fail,
                duration_ms: 0,
                failure: Some(parse_failure(message, root)),
            });
        }
    }
    let count = |s| tests.iter().filter(|t| t.status == s).count();
    Ok(TestReport {
        success: count(TestStatus::Fail) == 0,
        passed: count(TestStatus::Pass),
        failed: count(TestStatus::Fail),
        skipped: count(TestStatus::Skip),
        tests,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_vitest_report_with_two_failures() {
        // Generated from express-notes with two bugs added (201 → 200, a changed error message).
        let json = include_str!("../tests/fixtures/vitest-report.json");
        let r = parse_report(json, "/project").unwrap();
        assert!(!r.success);
        assert_eq!((r.passed, r.failed, r.skipped), (10, 2, 0));

        let failing: Vec<_> = r
            .tests
            .iter()
            .filter(|t| t.status == TestStatus::Fail)
            .collect();
        assert_eq!(failing[0].file, "tests/notes.api.test.ts");
        assert_eq!(
            failing[0].name,
            "/notes creates, reads, lists, updates and deletes a note"
        );
        assert_eq!(
            failing[0].failure,
            Some(Failure {
                message: "expected 200 to be 201 // Object.is equality".into(),
                expected: Some("201".into()),
                actual: Some("200".into()),
                file: Some("tests/notes.api.test.ts".into()),
                line: Some(23),
            })
        );
        let second = failing[1].failure.as_ref().unwrap();
        assert_eq!(second.expected.as_deref(), Some("'title is required'"));
        assert_eq!(second.actual.as_deref(), Some("[ 'title missing' ]"));
        // node_modules frames are skipped to find the test's own line.
        assert_eq!(
            (second.file.as_deref(), second.line),
            (Some("tests/notes.api.test.ts"), Some(42))
        );
    }

    #[test]
    fn jest_style_messages_and_windows_paths() {
        let raw = "Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 401\nReceived: 200\n    at Object.<anonymous> (C:\\work\\api\\tests\\auth.test.ts:12:34)\n    at node:internal/process/task_queues:95:5";
        let f = parse_failure(raw, "C:\\work\\api");
        assert_eq!(f.expected.as_deref(), Some("401"));
        assert_eq!(f.actual.as_deref(), Some("200"));
        assert_eq!(f.file.as_deref(), Some("tests/auth.test.ts"));
        assert_eq!(f.line, Some(12));
    }

    #[test]
    fn suite_that_cannot_load() {
        let json = r#"{"testResults":[{"name":"/p/tests/a.test.ts","status":"failed","message":"Error: Cannot find module '../src/app.js'","assertionResults":[]}]}"#;
        let r = parse_report(json, "/p").unwrap();
        assert!(!r.success);
        assert_eq!(r.tests[0].name, "tests/a.test.ts (could not run)");
        assert_eq!(
            r.tests[0].failure.as_ref().unwrap().message,
            "Cannot find module '../src/app.js'"
        );
    }
}
