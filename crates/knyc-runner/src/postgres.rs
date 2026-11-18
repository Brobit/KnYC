//! A Postgres server for a check (#116): a project on Postgres can't run its database checks without
//! one. Each check run gets its own container (labelled `knyc=check`, its data in memory) on its own
//! network, removed when the run ends. The command gets two URLs:
//!
//! - `DATABASE_URL`: the `knyc` database, there from the start (code that connects on import);
//! - `KNYC_POSTGRES_URL`: the server without a database, for a fresh database per test
//!   (`${KNYC_POSTGRES_URL}/t1`, which `prisma migrate deploy` creates).
//!
//! In local mode the server is published on a free port of 127.0.0.1; in Docker mode (#91) the
//! check's container joins the network and reaches it as `postgres`.

use serde::Deserialize;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The database server a check needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Database {
    Postgres,
}

impl std::str::FromStr for Database {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "postgres" => Ok(Self::Postgres),
            other => Err(format!("unknown database {other} (expected postgres)")),
        }
    }
}

pub const IMAGE: &str = "postgres:16-alpine";
const USER: &str = "knyc";
/// Host name of the server on its network (Docker mode).
const ALIAS: &str = "postgres";

/// A running server; dropping it removes the container and its network.
#[derive(Debug)]
pub struct Postgres {
    name: String,
    /// Reachable from the machine: postgresql://knyc:knyc@127.0.0.1:<port>
    pub local_url: String,
    /// Reachable from a container on `network`: postgresql://knyc:knyc@postgres:5432
    pub container_url: String,
    pub network: String,
}

fn docker() -> Command {
    let mut command = Command::new("docker");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

/// Runs docker; its trimmed stdout, or its stderr as the error.
fn output(args: &[&str]) -> anyhow::Result<String> {
    let out = docker()
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| anyhow::anyhow!("Docker isn't available ({e})"))?;
    if !out.status.success() {
        anyhow::bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

impl Postgres {
    /// Starts a server and waits until it accepts connections (`ready_within`, the image's pull
    /// included the first time).
    pub fn start(ready_within: Duration) -> anyhow::Result<Self> {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let name = format!(
            "knyc-pg-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        output(&["network", "create", "--label", "knyc=check", &name])
            .map_err(|e| anyhow::anyhow!("this check needs Postgres in Docker: {e}"))?;
        // From here on, Drop cleans up.
        let mut server = Self {
            name: name.clone(),
            local_url: String::new(),
            container_url: format!("postgresql://{USER}:{USER}@{ALIAS}:5432"),
            network: name.clone(),
        };
        let env_user = format!("POSTGRES_USER={USER}");
        let env_password = format!("POSTGRES_PASSWORD={USER}");
        let env_db = format!("POSTGRES_DB={USER}");
        output(&[
            "run",
            "-d",
            "--label",
            "knyc=check",
            "--name",
            &name,
            "--network",
            &name,
            "--network-alias",
            ALIAS,
            "-p",
            "127.0.0.1::5432",
            "--tmpfs",
            "/var/lib/postgresql/data",
            "-e",
            &env_user,
            "-e",
            &env_password,
            "-e",
            &env_db,
            IMAGE,
            // A throwaway server: durability only slows the tests down.
            "-c",
            "fsync=off",
            "-c",
            "synchronous_commit=off",
            "-c",
            "full_page_writes=off",
        ])
        .map_err(|e| anyhow::anyhow!("couldn't start Postgres in Docker: {e}"))?;
        // "127.0.0.1:55012" (one line per published address).
        let published = output(&["port", &name, "5432/tcp"])?;
        let port = published
            .lines()
            .find_map(|l| l.rsplit_once(':').map(|(_, p)| p.to_string()))
            .ok_or_else(|| anyhow::anyhow!("Postgres has no published port: {published}"))?;
        server.local_url = format!("postgresql://{USER}:{USER}@127.0.0.1:{port}");

        // Over TCP: during its first start the image runs a temporary server on the socket only.
        let started = Instant::now();
        loop {
            let ready = docker()
                .args([
                    "exec",
                    &name,
                    "pg_isready",
                    "-h",
                    "127.0.0.1",
                    "-U",
                    USER,
                    "-d",
                    USER,
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success());
            if ready {
                return Ok(server);
            }
            if started.elapsed() > ready_within {
                let logs = docker()
                    .args(["logs", "--tail", "20", &name])
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stderr).into_owned())
                    .unwrap_or_default();
                anyhow::bail!("Postgres didn't start in time:\n{logs}");
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    /// The variables the check's command gets, `url` being the server's URL from where it runs.
    pub fn env(url: &str) -> [(String, String); 2] {
        [
            ("DATABASE_URL".into(), format!("{url}/{USER}")),
            ("KNYC_POSTGRES_URL".into(), url.to_string()),
        ]
    }
}

impl Drop for Postgres {
    fn drop(&mut self) {
        let _ = output(&["rm", "-f", "-v", &self.name]);
        let _ = output(&["network", "rm", &self.network]);
    }
}

#[cfg(test)]
mod docker_tests {
    use super::*;
    use crate::run::{RunSpec, run};

    /// Needs Docker; pulls postgres:16-alpine the first time.
    #[test]
    #[ignore = "needs Docker: cargo test -p knyc-runner -- --ignored postgres"]
    fn postgres_runs_next_to_a_command_and_is_removed_after() {
        let dir = tempfile::tempdir().unwrap();
        let mut spec = RunSpec::new(
            if cfg!(windows) {
                "echo %DATABASE_URL% %KNYC_POSTGRES_URL%"
            } else {
                "echo $DATABASE_URL $KNYC_POSTGRES_URL"
            },
            dir.path(),
        );
        spec.database = Some(Database::Postgres);
        spec.timeout = Duration::from_secs(120);
        let out = run(&spec).unwrap();
        assert!(out.success(), "{out:?}");
        let urls: Vec<_> = out.stdout.split_whitespace().collect();
        assert!(
            urls[0].starts_with("postgresql://knyc:knyc@127.0.0.1:") && urls[0].ends_with("/knyc"),
            "{urls:?}"
        );

        // Docker mode: the check's container reaches the server by its alias.
        let mut spec = RunSpec::new(
            "node -e \"require('net').connect(5432, 'postgres', function () { console.log(process.env.DATABASE_URL); this.end(); })\"",
            dir.path(),
        );
        spec.container = Some(crate::container::Container {
            image: "node:22-slim".into(),
            mount: dir.path().to_path_buf(),
            network: None,
        });
        spec.database = Some(Database::Postgres);
        spec.timeout = Duration::from_secs(300);
        let out = run(&spec).unwrap();
        assert!(out.success(), "{out:?}");
        assert_eq!(
            out.stdout.trim(),
            "postgresql://knyc:knyc@postgres:5432/knyc"
        );

        let left = output(&["ps", "-aq", "--filter", "name=knyc-pg-"]).unwrap();
        assert_eq!(left, "", "the server's container is removed");
    }
}
