//! `knyc-sys`: the system layer of KnYC as a command-line tool. Every command prints one JSON
//! document on stdout; errors go to stderr with a non-zero exit code. The TypeScript pipeline
//! spawns it (design/06-roadmap.md, M1). The desktop app calls the same crates directly.

use anyhow::Result;
use clap::{Parser, Subcommand};
use knyc_analyzer::{graph, intake, scan};
use std::path::PathBuf;

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
    }
}
