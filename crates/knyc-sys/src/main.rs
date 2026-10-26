//! `knyc-sys`: the system layer of KnYC as a command-line tool. Every command prints one JSON
//! document on stdout; errors go to stderr with a non-zero exit code. The TypeScript pipeline
//! spawns it (design/06-roadmap.md, M1). The desktop app calls the same crates directly.

use anyhow::Result;
use clap::{Parser, Subcommand};
use knyc_analyzer::{graph, intake, scan};
use knyc_runner::check::run_check;
use knyc_runner::run::RunSpec;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Parser)]
#[command(
    name = "knyc-sys",
    version,
    about = "KnYC system commands, with JSON output"
)]
struct Cli {
    /// Pretty-print the JSON output.
    #[arg(long, global = true)]
    pretty: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Copy a project into an empty sandbox folder, without secrets or ignored folders.
    Intake { source: PathBuf, sandbox: PathBuf },
    /// Static scan of a project: languages, packages, frameworks, commands, files (scan.json).
    Scan {
        folder: PathBuf,
        /// Don't run `node --version`, `docker --version`… to detect installed toolchains.
        #[arg(long)]
        no_toolchains: bool,
    },
    /// Code graph: imports, exports, symbols, dependencies, cycles and layers (graph.json).
    Graph { folder: PathBuf },
    /// Run a command as a check: timeout, process-tree kill, optional Jest/Vitest JSON report.
    /// Example: knyc-sys run --cwd app --report r.json -- npx vitest run --reporter=json --outputFile=r.json
    Run {
        /// Working directory.
        #[arg(long)]
        cwd: PathBuf,
        #[arg(long, default_value_t = 60_000)]
        timeout_ms: u64,
        /// Extra environment variable, as NAME=value (repeatable).
        #[arg(long = "env", value_parser = parse_env)]
        env: Vec<(String, String)>,
        /// Text sent to the command's stdin.
        #[arg(long)]
        stdin: Option<String>,
        /// Jest/Vitest JSON report the command writes, relative to --cwd.
        #[arg(long)]
        report: Option<PathBuf>,
        /// Docker mode (#91): run inside this image, with --mount mounted at /work.
        #[arg(long, requires = "mount")]
        docker_image: Option<String>,
        /// The folder mounted in Docker mode (--cwd must be inside it).
        #[arg(long)]
        mount: Option<PathBuf>,
        /// The command line, after `--`.
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
    /// Run an HTTP check: start the server, wait for its ready path, send the requests, stop it.
    /// `--spec` is the check spec as JSON: {"server": {...}, "requests": [...]}.
    /// Run a Docker check: build the image, run it and wait for its health path when asked, then
    /// remove what it made. `--spec` is the check spec as JSON: {"context", "dockerfile", "run"?}.
    Docker {
        #[arg(long)]
        cwd: PathBuf,
        #[arg(long, default_value_t = 300_000)]
        timeout_ms: u64,
        #[arg(long)]
        spec: String,
    },
    Http {
        /// Working directory (the package that starts the server).
        #[arg(long)]
        cwd: PathBuf,
        #[arg(long, default_value_t = 30_000)]
        timeout_ms: u64,
        #[arg(long)]
        spec: String,
        /// Docker mode (#91): the server runs in this image, with --mount mounted at /work.
        #[arg(long, requires = "mount")]
        docker_image: Option<String>,
        #[arg(long)]
        mount: Option<PathBuf>,
    },
    /// Run UI tests in headless Chromium against the project's frontend server (#89).
    Ui {
        /// Working directory (the package that starts the server).
        #[arg(long)]
        cwd: PathBuf,
        #[arg(long, default_value_t = 60_000)]
        timeout_ms: u64,
        /// {"server": …, "tests": [absolute paths of the UI test modules]}
        #[arg(long)]
        spec: String,
        /// Where Chromium is downloaded (KnYC's data folder).
        #[arg(long)]
        browsers: PathBuf,
        /// KnYC's runner (default: packages/ui-runner/run.mjs of this checkout).
        #[arg(long)]
        runner: Option<PathBuf>,
        #[arg(long, requires = "mount")]
        docker_image: Option<String>,
        #[arg(long)]
        mount: Option<PathBuf>,
    },
    /// Chromium for the UI checks: status, size (bytes to download) or install (#89).
    Browser {
        #[arg(value_parser = ["status", "size", "install"])]
        action: String,
        #[arg(long)]
        browsers: PathBuf,
        #[arg(long)]
        runner: Option<PathBuf>,
    },
}

#[derive(serde::Deserialize)]
struct UiSpec {
    server: knyc_runner::http::ServerSpec,
    tests: Vec<PathBuf>,
}

/// The UI runner given, or the one of this checkout (next to the knyc-sys executable's repo).
fn ui_runner(runner: Option<PathBuf>, browsers: PathBuf) -> Result<knyc_runner::ui::UiRunner> {
    let near = std::env::current_exe()?;
    let script = runner
        .or_else(|| knyc_runner::ui::find_runner(None, &near))
        .ok_or_else(|| {
            anyhow::anyhow!("KnYC's UI runner wasn't found (packages/ui-runner/run.mjs)")
        })?;
    Ok(knyc_runner::ui::UiRunner { script, browsers })
}

#[derive(serde::Deserialize)]
struct HttpSpec {
    server: knyc_runner::http::ServerSpec,
    requests: Vec<knyc_runner::http::HttpRequestSpec>,
}

/// Docker mode's container, when both the image and the mounted folder are given.
fn container(
    image: Option<String>,
    mount: Option<PathBuf>,
) -> Option<knyc_runner::container::Container> {
    Some(knyc_runner::container::Container {
        image: image?,
        mount: mount?,
    })
}

fn parse_env(raw: &str) -> Result<(String, String), String> {
    raw.split_once('=')
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .ok_or_else(|| format!("expected NAME=value, got {raw}"))
}

fn print(value: &impl serde::Serialize, pretty: bool) -> Result<()> {
    let json = if pretty {
        serde_json::to_string_pretty(value)?
    } else {
        serde_json::to_string(value)?
    };
    println!("{json}");
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Intake { source, sandbox } => {
            print(&intake::intake(&source, &sandbox)?, cli.pretty)
        }
        Commands::Scan {
            folder,
            no_toolchains,
        } => print(
            &scan::scan(
                &folder,
                scan::ScanOptions {
                    detect_toolchains: !no_toolchains,
                },
            )?,
            cli.pretty,
        ),
        Commands::Graph { folder } => print(&graph::build(&folder)?, cli.pretty),
        Commands::Run {
            cwd,
            timeout_ms,
            env,
            stdin,
            report,
            docker_image,
            mount,
            command,
        } => {
            let mut spec = RunSpec::new(command.join(" "), cwd);
            spec.timeout = Duration::from_millis(timeout_ms);
            spec.env = env.into_iter().collect();
            spec.stdin = stdin;
            spec.container = container(docker_image, mount);
            print(&run_check(&spec, report), cli.pretty)
        }
        Commands::Docker {
            cwd,
            timeout_ms,
            spec,
        } => {
            let spec: knyc_runner::docker::DockerSpec = serde_json::from_str(&spec)?;
            print(
                &knyc_runner::docker::run_docker_check(
                    &spec,
                    &cwd,
                    Duration::from_millis(timeout_ms),
                ),
                cli.pretty,
            )
        }
        Commands::Http {
            cwd,
            timeout_ms,
            spec,
            docker_image,
            mount,
        } => {
            let spec: HttpSpec = serde_json::from_str(&spec)?;
            print(
                &knyc_runner::http::run_http_check_in(
                    &spec.server,
                    &spec.requests,
                    &cwd,
                    Duration::from_millis(timeout_ms),
                    container(docker_image, mount).as_ref(),
                ),
                cli.pretty,
            )
        }
        Commands::Ui {
            cwd,
            timeout_ms,
            spec,
            browsers,
            runner,
            docker_image,
            mount,
        } => {
            let spec: UiSpec = serde_json::from_str(&spec)?;
            print(
                &knyc_runner::ui::run_ui_check(
                    &spec.server,
                    &spec.tests,
                    &cwd,
                    &ui_runner(runner, browsers)?,
                    Duration::from_millis(timeout_ms),
                    container(docker_image, mount).as_ref(),
                ),
                cli.pretty,
            )
        }
        Commands::Browser {
            action,
            browsers,
            runner,
        } => print(
            &knyc_runner::ui::browser(&ui_runner(runner, browsers)?, &action)?,
            cli.pretty,
        ),
    }
}
