//! Compose checks (#100): the services of a compose file build and come up (healthy, when they
//! say how), and each published port answers HTTP. The check runs a copy of the file's normalized
//! config (`docker compose config`): its published ports moved to free ones (8080 may be taken on
//! the learner's machine), its containers and built images labeled `knyc=check` like the Docker
//! checks, in a project of its own (`knyc-check-…`) that `down` removes with its networks and
//! volumes. Leftovers of a check killed halfway are found by the label.

use crate::docker::{
    DockerCheckOutcome, DockerStatus, cut_tail, docker, docker_running, unique_tag,
};
use crate::http::{free_port, request};
use crate::run::{RunSpec, run};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

const MAX_OUTPUT: usize = 16 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeSpec {
    /// The compose file, relative to the working directory.
    pub compose: String,
}

/// Adds `knyc=check` to a `labels` value (a map, or a list of "key=value").
fn add_label(labels: &mut Value) {
    match labels {
        Value::Array(list) => list.push(json!("knyc=check")),
        Value::Object(map) => {
            map.insert("knyc".into(), json!("check"));
        }
        _ => *labels = json!({ "knyc": "check" }),
    }
}

/// The config the check runs, and each service's published ports as (service, host port, port in
/// the container's file). Published ports get `free` ones.
fn prepare(
    config: &Value,
    mut free: impl FnMut() -> Option<u16>,
) -> (Value, Vec<(String, u16, String)>) {
    let mut config = config.clone();
    let mut ports = Vec::new();
    for (name, service) in config["services"].as_object_mut().into_iter().flatten() {
        add_label(
            service
                .as_object_mut()
                .map_or(&mut Value::Null, |s| s.entry("labels").or_insert(json!({}))),
        );
        if let Some(build) = service.get_mut("build").and_then(Value::as_object_mut) {
            add_label(build.entry("labels").or_insert(json!({})));
        }
        for port in service
            .get_mut("ports")
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            let original = match &port["published"] {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => continue,
            };
            if let Some(host) = free() {
                port["published"] = json!(host.to_string());
                ports.push((name.clone(), host, original));
            }
        }
    }
    (config, ports)
}

pub fn run_compose_check(spec: &ComposeSpec, cwd: &Path, timeout: Duration) -> DockerCheckOutcome {
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
    // Absolute: the commands run in `cwd`, which may itself be relative.
    let file =
        dunce::canonicalize(cwd.join(&spec.compose)).unwrap_or_else(|_| cwd.join(&spec.compose));
    if !file.is_file() {
        return done(
            DockerStatus::Fail,
            "build",
            String::new(),
            Some(format!("{} doesn't exist", spec.compose)),
        );
    }
    let file_arg = file.to_string_lossy().to_string();
    let config_text = docker(&["compose", "-f", &file_arg, "config", "--format", "json"]);
    let Ok(config) = serde_json::from_str::<Value>(config_text.trim_start_matches(|c| c != '{'))
    else {
        return done(
            DockerStatus::Fail,
            "build",
            config_text,
            Some(format!("{} isn't a valid compose file", spec.compose)),
        );
    };

    let (prepared, ports) = prepare(&config, || free_port().ok());
    let Ok(dir) = tempfile::tempdir() else {
        return done(
            DockerStatus::Error,
            "build",
            String::new(),
            Some("no temporary folder".into()),
        );
    };
    let prepared_file = dir.path().join("compose.json");
    if std::fs::write(&prepared_file, prepared.to_string()).is_err() {
        return done(
            DockerStatus::Error,
            "build",
            String::new(),
            Some("no temporary folder".into()),
        );
    }
    let prepared_arg = prepared_file.to_string_lossy().to_string();
    let project = unique_tag();
    let logs = || {
        docker(&[
            "compose",
            "-p",
            &project,
            "-f",
            &prepared_arg,
            "logs",
            "--no-color",
            "--tail",
            "50",
        ])
    };
    let down = || {
        docker(&[
            "compose",
            "-p",
            &project,
            "-f",
            &prepared_arg,
            "down",
            "-v",
            "--rmi",
            "local",
            "--remove-orphans",
        ]);
    };

    // `--wait`: running, and healthy for the services that have a healthcheck.
    let wait_secs = timeout.saturating_sub(started.elapsed()).as_secs().max(10);
    let mut up = RunSpec::new(
        format!(
            "docker compose -p {project} -f \"{prepared_arg}\" up -d --build --wait --wait-timeout {wait_secs}"
        ),
        cwd.to_path_buf(),
    );
    up.timeout = timeout.saturating_sub(started.elapsed());
    let up = match run(&up) {
        Ok(up) => up,
        Err(error) => {
            down();
            return done(
                DockerStatus::Error,
                "up",
                String::new(),
                Some(error.to_string()),
            );
        }
    };
    let mut output = format!("{}{}", up.stdout, up.stderr);
    if up.timed_out || up.exit_code != Some(0) {
        output.push_str("\n--- logs ---\n");
        output.push_str(&logs());
        down();
        let status = if up.timed_out {
            DockerStatus::Timeout
        } else {
            DockerStatus::Fail
        };
        return done(
            status,
            "up",
            output,
            Some("the services don't come up".into()),
        );
    }

    // Every published port answers (a 4xx is an answer: the server runs; a 5xx isn't).
    let deadline = started + timeout;
    let mut silent = Vec::new();
    for (service, host, original) in &ports {
        let answer = loop {
            if let Ok((status, _)) = request(
                *host,
                "GET",
                "/",
                &BTreeMap::new(),
                None,
                Duration::from_millis(1000),
            ) {
                break Some(status);
            }
            if Instant::now() >= deadline {
                break None;
            }
            thread::sleep(Duration::from_millis(300));
        };
        match answer {
            Some(status) if status < 500 => {}
            Some(status) => silent.push(format!(
                "{service} answered {status} on its port {original}"
            )),
            None => silent.push(format!("{service} didn't answer on its port {original}")),
        }
    }
    output.push_str("\n--- logs ---\n");
    output.push_str(&logs());
    down();
    if silent.is_empty() {
        done(DockerStatus::Pass, "health", output, None)
    } else {
        done(
            DockerStatus::Fail,
            "health",
            output,
            Some(silent.join("; ")),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_published_ports_and_labels_every_service() {
        let config = json!({ "services": {
            "api": { "build": { "context": "/app" }, "ports": [{ "target": 3000, "published": "3000" }] },
            "web": { "image": "nginx", "labels": ["team=web"], "ports": [{ "target": 80, "published": 8080 }] },
            "db": { "image": "postgres" }
        }});
        let mut next = 40000;
        let (prepared, ports) = prepare(&config, || {
            next += 1;
            Some(next)
        });
        assert_eq!(
            ports,
            vec![
                ("api".to_string(), 40001, "3000".to_string()),
                ("web".to_string(), 40002, "8080".to_string())
            ]
        );
        assert_eq!(
            prepared["services"]["api"]["ports"][0]["published"],
            "40001"
        );
        assert_eq!(
            prepared["services"]["api"]["build"]["labels"]["knyc"],
            "check"
        );
        assert_eq!(
            prepared["services"]["web"]["labels"],
            json!(["team=web", "knyc=check"])
        );
        assert_eq!(prepared["services"]["db"]["labels"]["knyc"], "check");
    }

    #[test]
    #[ignore = "needs Docker; run with --ignored"]
    fn a_compose_file_comes_up_answers_and_leaves_nothing() {
        if !docker_running() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("www")).unwrap();
        std::fs::write(dir.path().join("www/index.html"), "ok").unwrap();
        std::fs::write(dir.path().join("Dockerfile"), "FROM busybox:1.37\nCOPY www /www\nCMD [\"httpd\", \"-f\", \"-p\", \"8000\", \"-h\", \"/www\"]\n").unwrap();
        std::fs::write(
            dir.path().join("compose.yml"),
            "services:\n  web:\n    build: .\n    ports:\n      - \"8080:8000\"\n",
        )
        .unwrap();
        let out = run_compose_check(
            &ComposeSpec {
                compose: "compose.yml".into(),
            },
            dir.path(),
            Duration::from_secs(180),
        );
        assert_eq!(
            out.status,
            DockerStatus::Pass,
            "{:?}\n{}",
            out.error,
            out.output
        );
        assert_eq!(
            docker(&["ps", "-aq", "--filter", "label=knyc=check"]).trim(),
            ""
        );
        assert_eq!(
            docker(&["images", "-q", "--filter", "label=knyc=check"]).trim(),
            ""
        );
    }
}
