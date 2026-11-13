//! Deployment files in the code graph (#100): a Dockerfile, a compose file and a CI workflow are
//! each one whole-file unit. A compose file imports the Dockerfiles its services build, so it
//! comes after them.

use super::parse::{Import, ParsedFile};
use regex::Regex;
use std::sync::LazyLock;

static BUILD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\s*)build:\s*(.*?)\s*$").unwrap());
static KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*(context|dockerfile):\s*(.+?)\s*$").unwrap());
static FLOW_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(context|dockerfile):\s*([^,}]+)").unwrap());

fn unquote(value: &str) -> String {
    value
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_string()
}

/// The Dockerfiles a compose file's services build, relative to the compose file's folder.
pub fn compose_dockerfiles(source: &str) -> Vec<String> {
    let lines: Vec<&str> = source.lines().collect();
    let mut found = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let Some(build) = BUILD.captures(line) else {
            continue;
        };
        let indent = build[1].len();
        let value = build[2].split(" #").next().unwrap_or_default().trim();
        let (mut context, mut dockerfile) = (".".to_string(), "Dockerfile".to_string());
        if value.starts_with('{') {
            for c in FLOW_KEY.captures_iter(value) {
                if &c[1] == "context" {
                    context = unquote(&c[2]);
                } else {
                    dockerfile = unquote(&c[2]);
                }
            }
        } else if !value.is_empty() {
            context = unquote(value);
        } else {
            for next in &lines[i + 1..] {
                if next.trim().is_empty() {
                    continue;
                }
                if next.len() - next.trim_start().len() <= indent {
                    break;
                }
                if let Some(c) = KEY.captures(next) {
                    if &c[1] == "context" {
                        context = unquote(&c[2]);
                    } else {
                        dockerfile = unquote(&c[2]);
                    }
                }
            }
        }
        let path = if context == "." {
            dockerfile
        } else {
            format!("{}/{dockerfile}", context.trim_end_matches('/'))
        };
        found.push(path.trim_start_matches("./").to_string());
    }
    found
}

/// A compose file imports the Dockerfiles it builds; other YAML (a CI workflow) imports nothing.
pub fn parse_yaml(source: &str) -> ParsedFile {
    ParsedFile {
        imports: compose_dockerfiles(source)
            .into_iter()
            .map(|path| Import {
                specifier: format!("./{path}"),
                names: Vec::new(),
                type_only: false,
                reexport: false,
            })
            .collect(),
        ..ParsedFile::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_compose_file_builds_these_dockerfiles() {
        let compose = r#"services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment:
      PORT: "3000"
  web:
    build: ./apps/web
  worker:
    build: { context: services/worker, dockerfile: "Dockerfile.prod" }
  db:
    image: postgres:17
"#;
        assert_eq!(
            compose_dockerfiles(compose),
            vec![
                "apps/api/Dockerfile",
                "apps/web/Dockerfile",
                "services/worker/Dockerfile.prod"
            ]
        );
    }
}
