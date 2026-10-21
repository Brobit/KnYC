//! Project intake, static scan and (later) code graph for KnYC.
//! See design/02-analysis-pipeline.md, stages ① and ②.

pub mod graph;
pub mod intake;
pub mod scan;
pub mod secrets;
pub mod walk;

/// Paths in reports are relative to the project root and always use `/`, on every OS.
pub(crate) fn rel_path(root: &std::path::Path, path: &std::path::Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}
