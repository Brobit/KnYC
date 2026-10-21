//! Runs a command as a check and reports pass / fail / timeout / error. The TypeScript side adds
//! the check id and date to make the stored `CheckRun` (design/03-data-model.md).

use crate::report::{TestReport, parse_report};
use crate::run::{RunResult, RunSpec, run};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckStatus {
    Pass,
    Fail,
    /// Exceeded its timeout; the process tree was killed.
    Timeout,
    /// Couldn't run at all (command not startable, unreadable report…).
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckOutcome {
    pub status: CheckStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run: Option<RunResult>,
    /// Parsed Jest/Vitest report, when one was requested and produced.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tests: Option<TestReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Runs `spec`. With `report`, the command is expected to write a Jest/Vitest JSON report to
/// that path (relative to the working directory); a stale report is deleted first.
pub fn run_check(spec: &RunSpec, report: Option<PathBuf>) -> CheckOutcome {
    let report_path = report.map(|p| spec.cwd.join(p));
    if let Some(path) = &report_path {
        let _ = std::fs::remove_file(path);
    }

    let result = match run(spec) {
        Ok(result) => result,
        Err(e) => {
            return CheckOutcome {
                status: CheckStatus::Error,
                run: None,
                tests: None,
                error: Some(format!("could not start the command: {e}")),
            };
        }
    };

    let mut error = None;
    let tests = report_path.as_ref().and_then(|path| {
        // Reports use absolute paths; resolve the working directory the same way.
        let root = dunce::canonicalize(&spec.cwd).unwrap_or_else(|_| spec.cwd.clone());
        let root = root.to_string_lossy();
        match std::fs::read_to_string(path)
            .map_err(anyhow::Error::from)
            .and_then(|json| parse_report(&json, &root))
        {
            Ok(report) => Some(report),
            Err(e) if !result.timed_out => {
                error = Some(format!(
                    "no readable test report at {}: {e}",
                    path.display()
                ));
                None
            }
            Err(_) => None,
        }
    });

    let status = if result.timed_out {
        CheckStatus::Timeout
    } else if report_path.is_some() && tests.is_none() {
        CheckStatus::Error
    } else if result.success() && tests.as_ref().is_none_or(|t| t.success) {
        CheckStatus::Pass
    } else {
        CheckStatus::Fail
    };
    CheckOutcome {
        status,
        run: Some(result),
        tests,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn statuses() {
        let dir = tempfile::tempdir().unwrap();
        let spec = |cmd: &str| RunSpec::new(cmd, dir.path());

        assert_eq!(
            run_check(&spec("node -e \"process.exit(0)\""), None).status,
            CheckStatus::Pass
        );
        assert_eq!(
            run_check(&spec("node -e \"process.exit(1)\""), None).status,
            CheckStatus::Fail
        );

        let mut slow = spec("node -e \"setTimeout(()=>{}, 5000)\"");
        slow.timeout = Duration::from_millis(300);
        assert_eq!(run_check(&slow, None).status, CheckStatus::Timeout);

        // A report was required but the command didn't write one.
        let outcome = run_check(
            &spec("node -e \"process.exit(0)\""),
            Some("report.json".into()),
        );
        assert_eq!(outcome.status, CheckStatus::Error);
        assert!(outcome.error.unwrap().contains("no readable test report"));
    }

    #[test]
    fn a_failing_report_fails_even_with_exit_code_zero() {
        let dir = tempfile::tempdir().unwrap();
        let report = r#"{"testResults":[{"name":"t.test.ts","assertionResults":[{"fullName":"x","status":"failed","failureMessages":["AssertionError: expected 1 to be 2"]}]}]}"#;
        std::fs::write(dir.path().join("fake-report.json"), report).unwrap();
        // The "command" copies a prepared report into place, standing in for vitest.
        let spec = RunSpec::new(
            "node -e \"require('fs').copyFileSync('fake-report.json','report.json')\"",
            dir.path(),
        );
        let outcome = run_check(&spec, Some("report.json".into()));
        assert_eq!(outcome.status, CheckStatus::Fail);
        assert_eq!(outcome.tests.unwrap().failed, 1);
    }
}
