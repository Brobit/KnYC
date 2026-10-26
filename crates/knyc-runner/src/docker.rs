//! Docker checks (#90, design/03 `docker` check spec): the image builds, and when the spec says
//! how, the container starts and answers on its health path. Everything a check makes is labeled
//! `knyc=check` and always removed (the learner's other images and containers are never touched).
//! Without Docker, or with its daemon stopped, the check is "unavailable" with the reason.

use crate::http::{free_port, request};
use crate::run::{RunSpec, run};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const LABEL: &str = "knyc=check";
const MAX_OUTPUT: usize = 16 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerRun {
    /// The port the container listens on.
    pub port: u16,
    pub health_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerSpec {
    /// Build context, relative to the working directory.
    pub context: String,
    /// Dockerfile path, relative to the working directory.
    pub dockerfile: String,
    pub run: Option<DockerRun>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DockerStatus {
    Pass,
    Fail,
    Timeout,
    Error,
    /// Docker isn't installed or its daemon isn't running.
    Unavailable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerCheckOutcome {
    pub status: DockerStatus,
    /// "build", "run", "health": how far it got.
    pub stage: &'static str,
    /// The build's output, then the container's logs; truncated.
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub duration_ms: u64,
}

fn no_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

/// Docker is installed and its daemon answers.
pub fn docker_running() -> bool {
    no_window(Command::new("docker").args(["info", "--format", "{{.ServerVersion}}"]))
        .output()
        .is_ok_and(|out| out.status.success())
}

/// A docker command that must finish quickly (removals, logs); its output, empty on failure.
fn docker(args: &[&str]) -> String {
    no_window(Command::new("docker").args(args))
        .output()
        .map(|out| {
            format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            )
        })
        .unwrap_or_default()
}

fn cut_tail(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &text[start..])
}

/// A tag no other check uses at the same time.
fn unique_tag() -> String {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!(
        "knyc-check-{}-{nanos:x}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

/// Builds the image (and runs it when `spec.run` is set), then removes everything it made.
pub fn run_docker_check(spec: &DockerSpec, cwd: &Path, timeout: Duration) -> DockerCheckOutcome {
    let started = Instant::now();
    let done = |status, stage, output: String, error: Option<String>| DockerCheckOutcome {
        status,
        stage,
        output: cut_tail(&output, MAX_OUTPUT),
        error,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    if !docker_running() {
        return done(
            DockerStatus::Unavailable,
            "build",
            String::new(),
            Some("Docker isn't installed or isn't running".into()),
        );
    }

    let tag = unique_tag();
    let mut build = RunSpec::new(
        format!(
            "docker build --label {LABEL} -f \"{}\" -t {tag} \"{}\"",
            spec.dockerfile, spec.context
        ),
        cwd.to_path_buf(),
    );
    build.timeout = timeout;
    let built = match run(&build) {
        Ok(result) => result,
        Err(e) => {
            return done(
                DockerStatus::Error,
                "build",
                String::new(),
                Some(format!("docker build couldn't start: {e}")),
            );
        }
    };
    let mut output = format!("{}{}", built.stdout, built.stderr);
    let remove_image = || {
        docker(&["rmi", "-f", &tag]);
    };
    if built.timed_out {
        remove_image();
        return done(
            DockerStatus::Timeout,
            "build",
            output,
            Some(format!(
                "the image didn't build within {} s",
                timeout.as_secs()
            )),
        );
    }
    if !built.success() {
        remove_image();
        return done(
            DockerStatus::Fail,
            "build",
            output,
            Some("the image doesn't build".into()),
        );
    }
    let Some(run_spec) = &spec.run else {
        remove_image();
        return done(DockerStatus::Pass, "build", output, None);
    };

    // The container on a free host port, removed whatever happens.
    let host_port = match free_port() {
        Ok(port) => port,
        Err(e) => {
            remove_image();
            return done(
                DockerStatus::Error,
                "run",
                output,
                Some(format!("no free port: {e}")),
            );
        }
    };
    let publish = format!("127.0.0.1:{host_port}:{}", run_spec.port);
    let started_container = docker(&["run", "-d", "--label", LABEL, "-p", &publish, &tag]);
    let id = started_container
        .lines()
        .last()
        .unwrap_or("")
        .trim()
        .to_string();
    let cleanup = |id: &str| {
        if !id.is_empty() {
            docker(&["rm", "-f", id]);
        }
        remove_image();
    };
    if id.len() < 12 || id.contains(' ') {
        cleanup("");
        output.push_str(&started_container);
        return done(
            DockerStatus::Fail,
            "run",
            output,
            Some("the container doesn't start".into()),
        );
    }

    let deadline = started + timeout;
    let quick = Duration::from_millis(500);
    let answer = loop {
        if let Ok((status, _)) = request(
            host_port,
            "GET",
            &run_spec.health_path,
            &BTreeMap::new(),
            None,
            quick,
        ) {
            break Some(status);
        }
        let state = docker(&["inspect", "-f", "{{.State.Running}}", &id]);
        if state.trim() == "false" || Instant::now() >= deadline {
            break None;
        }
        thread::sleep(Duration::from_millis(300));
    };
    output.push_str("\n--- container logs ---\n");
    output.push_str(&docker(&["logs", &id]));
    cleanup(&id);
    match answer {
        Some(status) if (200..400).contains(&status) => {
            done(DockerStatus::Pass, "health", output, None)
        }
        Some(status) => done(
            DockerStatus::Fail,
            "health",
            output,
            Some(format!("{} answered {status}", run_spec.health_path)),
        ),
        None => done(
            if Instant::now() >= deadline {
                DockerStatus::Timeout
            } else {
                DockerStatus::Fail
            },
            "run",
            output,
            Some(format!(
                "the container didn't answer {} on port {}",
                run_spec.health_path, run_spec.port
            )),
        ),
    }
}

/// Images and containers left by checks that were killed halfway (app closed): removed.
pub fn remove_leftovers() {
    let containers = docker(&["ps", "-aq", "--filter", &format!("label={LABEL}")]);
    for id in containers.split_whitespace() {
        docker(&["rm", "-f", id]);
    }
    let images = docker(&["images", "-q", "--filter", &format!("label={LABEL}")]);
    for id in images.split_whitespace() {
        docker(&["rmi", "-f", id]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labeled(kind: &str) -> String {
        docker(&[kind, "-aq", "--filter", &format!("label={LABEL}")])
            .trim()
            .to_string()
    }

    /// Needs Docker with Linux containers; pulls busybox (a few MB) the first time.
    #[test]
    #[ignore = "needs Docker: cargo test -p knyc-runner -- --ignored docker"]
    fn docker_builds_runs_and_cleans_up() {
        assert!(docker_running(), "Docker isn't running");
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("www")).unwrap();
        std::fs::write(dir.path().join("www/health"), "ok").unwrap();
        std::fs::write(dir.path().join("Dockerfile"), "FROM busybox:1.36\nCOPY www /www\nEXPOSE 8080\nCMD [\"httpd\", \"-f\", \"-p\", \"8080\", \"-h\", \"/www\"]\n").unwrap();
        let spec = DockerSpec {
            context: ".".into(),
            dockerfile: "Dockerfile".into(),
            run: Some(DockerRun {
                port: 8080,
                health_path: "/health".into(),
            }),
        };
        let out = run_docker_check(&spec, dir.path(), Duration::from_secs(120));
        assert_eq!(out.status, DockerStatus::Pass, "{out:?}");
        assert_eq!(out.stage, "health");

        let broken = DockerSpec {
            run: Some(DockerRun {
                port: 8080,
                health_path: "/missing".into(),
            }),
            ..spec.clone()
        };
        let out = run_docker_check(&broken, dir.path(), Duration::from_secs(120));
        assert_eq!(out.status, DockerStatus::Fail, "{out:?}");
        assert_eq!(out.error.as_deref(), Some("/missing answered 404"));

        std::fs::write(
            dir.path().join("Dockerfile"),
            "FROM busybox:1.36\nRUN exit 3\n",
        )
        .unwrap();
        let out = run_docker_check(
            &DockerSpec { run: None, ..spec },
            dir.path(),
            Duration::from_secs(120),
        );
        assert_eq!(out.status, DockerStatus::Fail);
        assert_eq!(out.stage, "build");

        // Nothing a check made is left behind.
        assert_eq!(labeled("ps"), "");
        assert_eq!(
            docker(&["images", "-q", "--filter", &format!("label={LABEL}")]).trim(),
            ""
        );
    }
}
