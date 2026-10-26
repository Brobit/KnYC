//! Docker mode (#91, design/03 `settings.runChecksIn`): a check's commands run inside a toolchain
//! container with the workspace mounted, so no local Node is needed. The same command lines run as
//! in local mode, from the same package folder; files the container writes (node_modules, dist)
//! belong to the learner's user on Linux and macOS.

use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    /// Toolchain image: "node:22-slim".
    pub image: String,
    /// Host folder mounted at /work (the workspace).
    pub mount: PathBuf,
}

const WORK: &str = "/work";

/// The user and group to run as, so the container's files stay the learner's (Unix only).
#[cfg(unix)]
fn user() -> Option<String> {
    use std::sync::OnceLock;
    static USER: OnceLock<Option<String>> = OnceLock::new();
    USER.get_or_init(|| {
        let id = |flag: &str| {
            std::process::Command::new("id")
                .arg(flag)
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        };
        Some(format!("{}:{}", id("-u")?, id("-g")?))
    })
    .clone()
}

#[cfg(not(unix))]
fn user() -> Option<String> {
    None
}

/// `docker run …` arguments that run `command` (a shell line) in `cwd`, which must be inside the
/// mounted folder. `publish`: host port → container port (on 127.0.0.1 only).
pub fn docker_args(
    container: &Container,
    command: &str,
    cwd: &Path,
    env: &BTreeMap<String, String>,
    publish: &[(u16, u16)],
    name: Option<&str>,
) -> anyhow::Result<Vec<String>> {
    let mount = dunce::canonicalize(&container.mount).unwrap_or_else(|_| container.mount.clone());
    let here = dunce::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    let inside = here
        .strip_prefix(&mount)
        .map_err(|_| anyhow::anyhow!("{} isn't inside {}", here.display(), mount.display()))?;
    let workdir = inside.components().fold(WORK.to_string(), |path, part| {
        format!("{path}/{}", part.as_os_str().to_string_lossy())
    });

    let mut args: Vec<String> = ["run", "--rm", "--init", "--label", "knyc=check"]
        .map(String::from)
        .to_vec();
    if let Some(name) = name {
        args.extend(["--name".into(), name.into()]);
    }
    if let Some(user) = user() {
        // npm needs a writable home when the user has none in the image.
        args.extend(["--user".into(), user, "-e".into(), "HOME=/tmp".into()]);
    }
    args.extend([
        "-v".into(),
        format!("{}:{WORK}", mount.display()),
        "-w".into(),
        workdir,
    ]);
    let quiet = [("CI", "true"), ("FORCE_COLOR", "0"), ("NO_COLOR", "1")];
    for (key, value) in quiet
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .chain(env.clone())
    {
        args.extend(["-e".into(), format!("{key}={value}")]);
    }
    for (host, inner) in publish {
        args.extend(["-p".into(), format!("127.0.0.1:{host}:{inner}")]);
    }
    args.extend([
        container.image.clone(),
        "sh".into(),
        "-c".into(),
        command.into(),
    ]);
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_the_command_in_the_package_folder_inside_the_mount() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("apps/api")).unwrap();
        let container = Container {
            image: "node:22-slim".into(),
            mount: dir.path().to_path_buf(),
        };
        let env = BTreeMap::from([("PORT".to_string(), "4100".to_string())]);
        let args = docker_args(
            &container,
            "npm run build",
            &dir.path().join("apps/api"),
            &env,
            &[(4100, 4100)],
            Some("knyc-srv-1"),
        )
        .unwrap();
        let joined = args.join(" ");
        assert!(
            joined.starts_with("run --rm --init --label knyc=check --name knyc-srv-1"),
            "{joined}"
        );
        assert!(joined.contains("-w /work/apps/api"), "{joined}");
        assert!(joined.contains("-e PORT=4100"), "{joined}");
        assert!(joined.contains("-p 127.0.0.1:4100:4100"), "{joined}");
        assert!(
            joined.ends_with("node:22-slim sh -c npm run build"),
            "{joined}"
        );
        let outside = tempfile::tempdir().unwrap();
        assert!(docker_args(&container, "x", outside.path(), &env, &[], None).is_err());
    }
}

#[cfg(test)]
mod docker_tests {
    use super::*;
    use crate::http::{Expectation, HttpRequestSpec, HttpStatus, ServerSpec, run_http_check_in};
    use crate::run::{RunSpec, run};
    use std::time::Duration;

    /// Needs Docker; pulls node:22-slim the first time.
    #[test]
    #[ignore = "needs Docker: cargo test -p knyc-runner -- --ignored docker_mode"]
    fn docker_mode_runs_commands_and_servers_in_the_container() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("api")).unwrap();
        std::fs::write(
            dir.path().join("api/server.js"),
            "require('http').createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ node: process.version, cwd: process.cwd() })); }).listen(process.env.PORT);\n",
        )
        .unwrap();
        let container = Container {
            image: "node:22-slim".into(),
            mount: dir.path().to_path_buf(),
        };

        let mut spec = RunSpec::new(
            "node -e \"console.log(process.cwd(), 1 + 1)\" && touch made.txt",
            dir.path().join("api"),
        );
        spec.container = Some(container.clone());
        spec.timeout = Duration::from_secs(300);
        let out = run(&spec).unwrap();
        assert!(out.success(), "{out:?}");
        assert_eq!(out.stdout.trim(), "/work/api 2");
        assert!(
            dir.path().join("api/made.txt").exists(),
            "files land in the workspace"
        );

        let server = ServerSpec {
            start: "node server.js".into(),
            port: 3000,
            ready_path: "/".into(),
            env: Default::default(),
            port_env: "PORT".into(),
        };
        let request = HttpRequestSpec {
            method: "GET".into(),
            path: "/".into(),
            headers: Default::default(),
            body: None,
            expect: Expectation {
                status: 200,
                json_subset: Some(serde_json::json!({ "cwd": "/work/api" })),
                body_includes: vec!["v22".into()],
            },
        };
        let out = run_http_check_in(
            &server,
            &[request],
            &dir.path().join("api"),
            Duration::from_secs(120),
            Some(&container),
        );
        assert_eq!(out.status, HttpStatus::Pass, "{out:?}");
        let left = std::process::Command::new("docker")
            .args(["ps", "-aq", "--filter", "name=knyc-server-"])
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&left.stdout).trim(),
            "",
            "the server's container is removed"
        );
    }
}
