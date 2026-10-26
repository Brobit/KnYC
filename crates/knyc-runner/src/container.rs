//! Docker mode (#91, design/03 `settings.runChecksIn`): a check's commands run inside a toolchain
//! container with the workspace mounted, so no local Node is needed. The same command lines run as
//! in local mode, from the same package folder; files the container writes (node_modules, dist)
//! belong to the learner's user on Linux and macOS.
//!
//! Each package's `node_modules` lives in a Docker volume (labelled `knyc=check`) rather than in
//! the mounted folder: on Docker Desktop, loading thousands of small files through the mount is
//! slow (Express takes ~7 s to load instead of ~0.5 s), and Linux-built modules stay out of the
//! learner's folder, so local mode keeps its own.

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

/// Folders the package search skips.
const SKIP: [&str; 5] = ["node_modules", "dist", "build", "coverage", "target"];

/// Package folders under `mount` (holding a package.json), relative to it; "" is the mount itself.
fn packages(mount: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, rel: PathBuf, depth: usize, found: &mut Vec<PathBuf>) {
        if dir.join("package.json").is_file() {
            found.push(rel.clone());
        }
        if depth == 0 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut dirs: Vec<_> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| !name.starts_with('.') && !SKIP.contains(&name.as_str()))
            .collect();
        dirs.sort();
        for name in dirs {
            walk(&dir.join(&name), rel.join(&name), depth - 1, found);
        }
    }
    let mut found = Vec::new();
    walk(mount, PathBuf::new(), 4, &mut found);
    found
}

/// A package's node_modules volume: its Docker name, where it's mounted, and the host folder
/// Docker makes for the mount point.
struct ModulesVolume {
    name: String,
    target: String,
    host: PathBuf,
}

fn container_path(rel: &Path) -> String {
    rel.components().fold(WORK.to_string(), |path, part| {
        format!("{path}/{}", part.as_os_str().to_string_lossy())
    })
}

fn modules_volumes(mount: &Path) -> Vec<ModulesVolume> {
    packages(mount)
        .into_iter()
        .map(|rel| {
            // FNV-1a: a stable name for the same package of the same workspace.
            let key = format!("{}\0{}", mount.display(), rel.display());
            let hash = key.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| {
                (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
            });
            ModulesVolume {
                name: format!("knyc-modules-{hash:016x}"),
                target: format!("{}/node_modules", container_path(&rel)),
                host: mount.join(&rel).join("node_modules"),
            }
        })
        .collect()
}

fn canonical(path: &Path) -> PathBuf {
    dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn docker(args: &[&str]) -> bool {
    let mut command = std::process::Command::new("docker");
    command
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command.status().is_ok_and(|s| s.success())
}

/// Creates the node_modules volumes, once per volume and process. A new volume belongs to root,
/// so on Linux and macOS it's handed to the learner's user, who the commands run as.
pub fn prepare(container: &Container) {
    use std::collections::HashSet;
    use std::sync::{Mutex, OnceLock};
    static READY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let ready = READY.get_or_init(Default::default);
    for volume in modules_volumes(&canonical(&container.mount)) {
        if ready.lock().is_ok_and(|r| r.contains(&volume.name)) {
            continue;
        }
        if !docker(&["volume", "create", "--label", "knyc=check", &volume.name]) {
            continue;
        }
        if let Some(user) = user() {
            let mount = format!("{}:/modules", volume.name);
            let owned = docker(&[
                "run",
                "--rm",
                "--label",
                "knyc=check",
                "--user",
                "0",
                "-v",
                &mount,
                &container.image,
                "chown",
                &user,
                "/modules",
            ]);
            if !owned {
                continue;
            }
        }
        if let Ok(mut r) = ready.lock() {
            r.insert(volume.name);
        }
    }
}

/// After a run: removes the empty node_modules folders Docker made on the host for the volumes'
/// mount points (a folder with files in it, the learner's own install, stays).
pub fn tidy(container: &Container) {
    for volume in modules_volumes(&canonical(&container.mount)) {
        let _ = std::fs::remove_dir(&volume.host);
    }
}

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
    let mount = canonical(&container.mount);
    let here = canonical(cwd);
    let inside = here
        .strip_prefix(&mount)
        .map_err(|_| anyhow::anyhow!("{} isn't inside {}", here.display(), mount.display()))?;
    let workdir = container_path(inside);

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
    for volume in modules_volumes(&mount) {
        args.extend(["-v".into(), format!("{}:{}", volume.name, volume.target)]);
    }
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
        std::fs::create_dir_all(dir.path().join("apps/api/node_modules/x")).unwrap();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        std::fs::write(dir.path().join("apps/api/package.json"), "{}").unwrap();
        std::fs::write(
            dir.path().join("apps/api/node_modules/x/package.json"),
            "{}",
        )
        .unwrap();
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
        // One node_modules volume per package (not for packages inside node_modules).
        let volumes: Vec<_> = args
            .windows(2)
            .filter(|w| w[0] == "-v" && w[1].starts_with("knyc-modules-"))
            .map(|w| w[1].split_once(':').unwrap().1.to_string())
            .collect();
        assert_eq!(
            volumes,
            ["/work/node_modules", "/work/apps/api/node_modules"]
        );
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
