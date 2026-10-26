//! Stage ②: static scan, no AI. What the project is made of and how to install, build, test and
//! run it. Produces `scan.json` (design/02-analysis-pipeline.md ②).

use crate::intake::source_hash;
use crate::secrets::SecretLine;
use crate::walk::{Excluded, Walk, WalkedFile, walk};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub root: String,
    pub hash: String,
    pub languages: Vec<Language>,
    pub packages: Vec<Package>,
    pub frameworks: Vec<Framework>,
    pub test_runners: Vec<TestRunner>,
    pub commands: Vec<Commands>,
    pub deployment: Vec<FileRef>,
    pub database: Vec<FileRef>,
    pub toolchains: Vec<Toolchain>,
    pub files: Vec<WalkedFile>,
    pub excluded: Vec<Excluded>,
    pub secret_lines: Vec<SecretLine>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Language {
    pub id: &'static str,
    pub files: usize,
    pub loc: usize,
}

/// One `package.json` (several in a monorepo).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    /// Folder containing the package.json, relative to the project ("." for the root).
    pub root: String,
    pub name: Option<String>,
    pub package_manager: &'static str,
    pub module_type: &'static str,
    pub typescript: bool,
    pub node_engine: Option<String>,
    pub scripts: BTreeMap<String, String>,
    pub dependencies: BTreeMap<String, String>,
    pub dev_dependencies: BTreeMap<String, String>,
    /// The root of an npm / yarn / pnpm workspace: one install here covers every package (#87).
    pub workspaces: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Framework {
    /// Framework profile id (design: VISION §6).
    pub profile_id: &'static str,
    pub version: Option<String>,
    pub root: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TestRunner {
    pub runner: &'static str,
    pub root: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commands {
    pub root: String,
    pub install: Option<String>,
    pub build: Option<String>,
    pub test: Option<String>,
    pub run: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub kind: &'static str,
    pub path: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Toolchain {
    pub id: &'static str,
    pub required: String,
    /// Installed version, or None when not found. Only filled when detection is enabled.
    pub found: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct ScanOptions {
    /// Run `node --version`, `docker --version`… to see what is installed.
    pub detect_toolchains: bool,
}

pub fn scan(root: &Path, options: ScanOptions) -> anyhow::Result<Scan> {
    let walked = walk(root)?;
    let packages = read_packages(&walked)?;
    let mut toolchains = required_toolchains(&walked, &packages);
    if options.detect_toolchains {
        for toolchain in &mut toolchains {
            toolchain.found = installed_version(toolchain.id);
        }
    }

    Ok(Scan {
        root: dunce::canonicalize(root)?.to_string_lossy().into_owned(),
        hash: source_hash(&walked)?,
        languages: languages(&walked),
        frameworks: frameworks(&walked, &packages),
        test_runners: test_runners(&walked, &packages),
        commands: packages.iter().map(|p| commands(&walked, p)).collect(),
        deployment: deployment_files(&walked),
        database: database_files(&walked, &packages),
        toolchains,
        packages,
        files: walked.files,
        excluded: walked.excluded,
        secret_lines: walked.secret_lines,
    })
}

fn extension(path: &str) -> &str {
    path.rsplit_once('.').map_or("", |(_, ext)| ext)
}

fn file_name(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

fn parent(path: &str) -> String {
    path.rsplit_once('/')
        .map_or_else(|| ".".to_string(), |(dir, _)| dir.to_string())
}

fn languages(walked: &Walk) -> Vec<Language> {
    let mut by_language: BTreeMap<&'static str, (usize, usize)> = BTreeMap::new();
    for file in walked.ai_files() {
        let id = match extension(&file.path) {
            "ts" | "tsx" | "mts" | "cts" => "typescript",
            "js" | "jsx" | "mjs" | "cjs" => "javascript",
            "py" => "python",
            "go" => "go",
            "cs" => "csharp",
            "html" | "htm" => "html",
            "css" | "scss" | "sass" | "less" => "css",
            _ => continue,
        };
        let entry = by_language.entry(id).or_default();
        entry.0 += 1;
        entry.1 += file.lines;
    }
    let mut languages: Vec<_> = by_language
        .into_iter()
        .map(|(id, (files, loc))| Language { id, files, loc })
        .collect();
    languages.sort_by_key(|l| std::cmp::Reverse(l.loc));
    languages
}

fn string_map(value: &Value) -> BTreeMap<String, String> {
    value
        .as_object()
        .map(|map| {
            map.iter()
                .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn read_packages(walked: &Walk) -> anyhow::Result<Vec<Package>> {
    let mut packages = Vec::new();
    for file in walked
        .files
        .iter()
        .filter(|f| file_name(&f.path) == "package.json")
    {
        let json: Value = match serde_json::from_slice(&std::fs::read(&file.abs)?) {
            Ok(json) => json,
            Err(_) => continue, // A broken package.json shouldn't stop the scan.
        };
        let root = parent(&file.path);
        let in_root = |name: &str| {
            let path = if root == "." {
                name.to_string()
            } else {
                format!("{root}/{name}")
            };
            walked.has(&path)
        };
        let declared = json["packageManager"].as_str().unwrap_or("");
        let package_manager = if in_root("pnpm-lock.yaml") || declared.starts_with("pnpm") {
            "pnpm"
        } else if in_root("yarn.lock") || declared.starts_with("yarn") {
            "yarn"
        } else if in_root("bun.lockb") || in_root("bun.lock") || declared.starts_with("bun") {
            "bun"
        } else {
            "npm"
        };
        let dev_dependencies = string_map(&json["devDependencies"]);
        packages.push(Package {
            name: json["name"].as_str().map(str::to_string),
            package_manager,
            module_type: if json["type"].as_str() == Some("module") {
                "module"
            } else {
                "commonjs"
            },
            typescript: dev_dependencies.contains_key("typescript") || in_root("tsconfig.json"),
            node_engine: json["engines"]["node"].as_str().map(str::to_string),
            scripts: string_map(&json["scripts"]),
            dependencies: string_map(&json["dependencies"]),
            dev_dependencies,
            workspaces: json["workspaces"].is_array()
                || json["workspaces"].is_object()
                || in_root("pnpm-workspace.yaml"),
            root,
        });
    }
    packages.sort_by(|a, b| a.root.cmp(&b.root));
    Ok(packages)
}

/// "^5.3.0" → "5.3.0"
fn clean_version(range: &str) -> String {
    range
        .trim_start_matches(|c: char| !c.is_ascii_digit())
        .to_string()
}

fn dependency<'a>(package: &'a Package, name: &str) -> Option<&'a String> {
    package
        .dependencies
        .get(name)
        .or_else(|| package.dev_dependencies.get(name))
}

/// Dependency → framework profile, most specific first (Next.js before React…).
const JS_FRAMEWORKS: &[(&str, &str)] = &[
    ("@nestjs/core", "nestjs"),
    ("next", "nextjs"),
    ("nuxt", "nuxt"),
    ("@angular/core", "angular"),
    ("@sveltejs/kit", "sveltekit"),
    ("vue", "vue"),
    ("react", "react"),
    ("svelte", "svelte"),
    ("express", "express"),
    ("fastify", "fastify"),
    ("koa", "koa"),
    ("hono", "hono"),
];

/// Frameworks that another detected framework already implies.
const IMPLIED: &[(&str, &str)] = &[
    ("nextjs", "react"),
    ("nuxt", "vue"),
    ("sveltekit", "svelte"),
    ("nestjs", "express"),
];

fn frameworks(walked: &Walk, packages: &[Package]) -> Vec<Framework> {
    let mut found = Vec::new();
    for package in packages {
        let mut here: Vec<Framework> = JS_FRAMEWORKS
            .iter()
            .filter_map(|(dep, profile_id)| {
                dependency(package, dep).map(|version| Framework {
                    profile_id,
                    version: Some(clean_version(version)),
                    root: package.root.clone(),
                })
            })
            .collect();
        let detected: Vec<_> = here.iter().map(|f| f.profile_id).collect();
        here.retain(|f| {
            !IMPLIED
                .iter()
                .any(|(parent, child)| *child == f.profile_id && detected.contains(parent))
        });
        found.extend(here);
    }

    // Non-JS stacks, by marker files.
    let text = |path: &str| {
        walked
            .files
            .iter()
            .find(|f| f.path == path)
            .and_then(|f| std::fs::read_to_string(&f.abs).ok())
            .unwrap_or_default()
            .to_lowercase()
    };
    for file in &walked.files {
        let name = file_name(&file.path);
        let root = parent(&file.path);
        if name == "requirements.txt" || name == "pyproject.toml" {
            let content = text(&file.path);
            for (marker, profile_id) in [
                ("fastapi", "fastapi"),
                ("django", "django"),
                ("flask", "flask"),
            ] {
                if content.contains(marker) && !found.iter().any(|f| f.profile_id == profile_id) {
                    found.push(Framework {
                        profile_id,
                        version: None,
                        root: root.clone(),
                    });
                }
            }
        } else if name == "go.mod" {
            let profile_id = if text(&file.path).contains("github.com/gin-gonic/gin") {
                "gin"
            } else {
                "go-net-http"
            };
            found.push(Framework {
                profile_id,
                version: None,
                root,
            });
        } else if name.ends_with(".csproj") && text(&file.path).contains("microsoft.net.sdk.web") {
            found.push(Framework {
                profile_id: "aspnetcore",
                version: None,
                root,
            });
        }
    }
    found
}

fn test_runners(walked: &Walk, packages: &[Package]) -> Vec<TestRunner> {
    let mut runners = Vec::new();
    for package in packages {
        for (dep, runner) in [
            ("vitest", "vitest"),
            ("jest", "jest"),
            ("mocha", "mocha"),
            ("@playwright/test", "playwright"),
        ] {
            if dependency(package, dep).is_some() {
                runners.push(TestRunner {
                    runner,
                    root: package.root.clone(),
                });
            }
        }
    }
    let any = |pred: &dyn Fn(&str) -> bool| walked.files.iter().any(|f| pred(&f.path));
    if any(&|p| file_name(p).starts_with("test_") && p.ends_with(".py") || p.ends_with("_test.py"))
    {
        runners.push(TestRunner {
            runner: "pytest",
            root: ".".into(),
        });
    }
    if any(&|p| p.ends_with("_test.go")) {
        runners.push(TestRunner {
            runner: "go",
            root: ".".into(),
        });
    }
    runners
}

fn commands(walked: &Walk, package: &Package) -> Commands {
    let pm = package.package_manager;
    let lockfile = match pm {
        "pnpm" => "pnpm-lock.yaml",
        "yarn" => "yarn.lock",
        "bun" => "bun.lockb",
        _ => "package-lock.json",
    };
    let has_lock = walked.has(&if package.root == "." {
        lockfile.to_string()
    } else {
        format!("{}/{lockfile}", package.root)
    });
    let install = match (pm, has_lock) {
        ("npm", true) => "npm ci",
        ("npm", false) => "npm install",
        ("pnpm", true) => "pnpm install --frozen-lockfile",
        ("yarn", true) => "yarn install --frozen-lockfile",
        ("bun", _) => "bun install",
        (_, _) => match pm {
            "pnpm" => "pnpm install",
            _ => "yarn install",
        },
    };
    let script = |name: &str| {
        package
            .scripts
            .get(name)
            .filter(|cmd| !cmd.contains("no test specified"))
            .map(|_| format!("{pm} run {name}"))
    };
    Commands {
        root: package.root.clone(),
        install: Some(install.to_string()),
        build: script("build"),
        test: script("test"),
        run: script("start").or_else(|| script("dev")),
    }
}

fn deployment_files(walked: &Walk) -> Vec<FileRef> {
    walked
        .files
        .iter()
        .filter_map(|f| {
            let name = file_name(&f.path).to_ascii_lowercase();
            let kind = if name.starts_with("dockerfile") || name.ends_with(".dockerfile") {
                "dockerfile"
            } else if name.starts_with("docker-compose") || name.starts_with("compose.") {
                "compose"
            } else if f.path.starts_with(".github/workflows/") {
                "github-actions"
            } else if name == ".gitlab-ci.yml" {
                "gitlab-ci"
            } else if [
                "vercel.json",
                "netlify.toml",
                "fly.toml",
                "render.yaml",
                "procfile",
            ]
            .contains(&name.as_str())
            {
                "platform"
            } else {
                return None;
            };
            Some(FileRef {
                kind,
                path: f.path.clone(),
            })
        })
        .collect()
}

fn database_files(walked: &Walk, packages: &[Package]) -> Vec<FileRef> {
    let mut found: Vec<FileRef> = walked
        .files
        .iter()
        .filter_map(|f| {
            let name = file_name(&f.path);
            let kind = if name.ends_with(".prisma") {
                "prisma-schema"
            } else if f.path.contains("migrations/") {
                "migration"
            } else if name.starts_with("drizzle.config") {
                "drizzle-config"
            } else if name.starts_with("ormconfig") || name.starts_with("knexfile") {
                "orm-config"
            } else if extension(name) == "sql" {
                "sql"
            } else {
                return None;
            };
            Some(FileRef {
                kind,
                path: f.path.clone(),
            })
        })
        .collect();
    for package in packages {
        for dep in [
            "@prisma/client",
            "typeorm",
            "drizzle-orm",
            "sequelize",
            "mongoose",
            "knex",
            "pg",
            "mysql2",
            "better-sqlite3",
            "sqlite3",
        ] {
            if dependency(package, dep).is_some() {
                found.push(FileRef {
                    kind: "driver",
                    path: format!("{}/package.json#{dep}", package.root),
                });
            }
        }
    }
    found
}

fn required_toolchains(walked: &Walk, packages: &[Package]) -> Vec<Toolchain> {
    let mut toolchains = Vec::new();
    if !packages.is_empty() {
        let required = packages
            .iter()
            .find_map(|p| p.node_engine.clone())
            .unwrap_or_else(|| "any".to_string());
        toolchains.push(Toolchain {
            id: "node",
            required,
            found: None,
        });
    }
    let has = |pred: &dyn Fn(&str) -> bool| walked.files.iter().any(|f| pred(&f.path));
    for (id, pred) in [
        (
            "python",
            &(|p: &str| p.ends_with(".py") || file_name(p) == "pyproject.toml")
                as &dyn Fn(&str) -> bool,
        ),
        ("go", &|p: &str| file_name(p) == "go.mod"),
        ("dotnet", &|p: &str| {
            p.ends_with(".csproj") || p.ends_with(".sln")
        }),
        ("docker", &|p: &str| {
            file_name(p).to_ascii_lowercase().starts_with("dockerfile")
        }),
    ] {
        if has(pred) {
            toolchains.push(Toolchain {
                id,
                required: "any".into(),
                found: None,
            });
        }
    }
    toolchains
}

/// The installed version of a toolchain ("22.23.2"), or None when it isn't found. Also used by the
/// app's onboarding (Node, npm, git…).
pub fn installed_version(id: &str) -> Option<String> {
    let candidates: &[(&str, &[&str])] = match id {
        "node" => &[("node", &["--version"])],
        // npm is a .cmd script on Windows: only cmd can start it.
        "npm" if cfg!(windows) => &[("cmd", &["/D", "/C", "npm", "--version"])],
        "npm" => &[("npm", &["--version"])],
        "git" => &[("git", &["--version"])],
        "python" => &[("python3", &["--version"]), ("python", &["--version"])],
        "go" => &[("go", &["version"])],
        "dotnet" => &[("dotnet", &["--version"])],
        "docker" => &[("docker", &["--version"])],
        _ => &[],
    };
    candidates.iter().find_map(|(program, args)| {
        let mut command = Command::new(program);
        command.args(*args);
        // No console window flashing when the desktop app (a GUI program) asks.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let output = command.output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        // "v22.23.2", "Python 3.12.4", "go version go1.23.2 …", "Docker version 27.1.1, build …"
        text.split(|c: char| c.is_whitespace() || c == ',')
            .find_map(|word| {
                let word = word.trim_start_matches('v').trim_start_matches("go");
                word.chars()
                    .next()
                    .filter(char::is_ascii_digit)
                    .map(|_| word.to_string())
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, path: &str, content: &str) {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }

    fn scan_dir(dir: &Path) -> Scan {
        scan(
            dir,
            ScanOptions {
                detect_toolchains: false,
            },
        )
        .unwrap()
    }

    #[test]
    fn workspace_roots() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(
            r,
            "package.json",
            r#"{"private":true,"workspaces":["apps/*"],"scripts":{"build":"npm run build --workspaces"}}"#,
        );
        write(r, "apps/api/package.json", r#"{"name":"api"}"#);
        let s = scan_dir(r);
        let flags: Vec<_> = s
            .packages
            .iter()
            .map(|p| (p.root.as_str(), p.workspaces))
            .collect();
        assert_eq!(flags, vec![(".", true), ("apps/api", false)]);

        let pnpm = tempfile::tempdir().unwrap();
        write(pnpm.path(), "package.json", r#"{"private":true}"#);
        write(
            pnpm.path(),
            "pnpm-workspace.yaml",
            "packages:
  - apps/*
",
        );
        assert!(scan_dir(pnpm.path()).packages[0].workspaces);
    }

    #[test]
    fn next_monorepo_with_docker_and_prisma() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(
            r,
            "apps/web/package.json",
            r#"{"name":"web","scripts":{"build":"next build","dev":"next dev"},"dependencies":{"next":"^15.1.0","react":"^19.0.0"}}"#,
        );
        write(r, "apps/web/pnpm-lock.yaml", "lockfileVersion: 9\n");
        write(
            r,
            "apps/web/app/page.tsx",
            "export default function Page() {}\n",
        );
        write(
            r,
            "apps/api/package.json",
            r#"{"type":"module","engines":{"node":">=20"},"scripts":{"test":"vitest run"},"dependencies":{"@nestjs/core":"~10.4.0","express":"^4.0.0","@prisma/client":"6.0.0"},"devDependencies":{"vitest":"^2.0.0","typescript":"^5"}}"#,
        );
        write(r, "apps/api/prisma/schema.prisma", "model User {}\n");
        write(
            r,
            "apps/api/prisma/migrations/001_init/migration.sql",
            "create table x();\n",
        );
        write(r, "Dockerfile", "FROM node:22\n");
        write(r, ".github/workflows/ci.yml", "name: CI\n");

        let s = scan_dir(r);
        assert_eq!(
            s.frameworks
                .iter()
                .map(|f| (f.profile_id, f.version.as_deref(), f.root.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("nestjs", Some("10.4.0"), "apps/api"),
                ("nextjs", Some("15.1.0"), "apps/web"),
            ],
            "React and Express are implied and not listed twice"
        );
        let api = &s.commands[0];
        assert_eq!(api.root, "apps/api");
        assert_eq!(api.install.as_deref(), Some("npm install"));
        assert_eq!(api.test.as_deref(), Some("npm run test"));
        let web = &s.commands[1];
        assert_eq!(
            web.install.as_deref(),
            Some("pnpm install --frozen-lockfile")
        );
        assert_eq!(web.run.as_deref(), Some("pnpm run dev"));
        assert_eq!(
            s.test_runners,
            vec![TestRunner {
                runner: "vitest",
                root: "apps/api".into()
            }]
        );
        assert!(s.packages[0].typescript);
        assert_eq!(s.packages[0].module_type, "module");

        let kinds = |refs: &[FileRef]| refs.iter().map(|f| f.kind).collect::<Vec<_>>();
        assert_eq!(kinds(&s.deployment), vec!["github-actions", "dockerfile"]);
        assert_eq!(
            kinds(&s.database),
            vec!["migration", "prisma-schema", "driver"]
        );
        assert_eq!(
            s.toolchains
                .iter()
                .map(|t| (t.id, t.required.as_str()))
                .collect::<Vec<_>>(),
            vec![("node", ">=20"), ("docker", "any")]
        );
    }

    #[test]
    fn placeholder_test_script_is_not_a_test_command() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "package.json",
            r#"{"scripts":{"test":"echo \"Error: no test specified\" && exit 1"}}"#,
        );
        assert_eq!(scan_dir(dir.path()).commands[0].test, None);
    }

    #[test]
    fn python_and_go_markers() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "api/requirements.txt",
            "FastAPI==0.115\nuvicorn\n",
        );
        write(dir.path(), "api/test_main.py", "def test_x(): pass\n");
        write(
            dir.path(),
            "svc/go.mod",
            "module x\nrequire github.com/gin-gonic/gin v1.10.0\n",
        );
        let s = scan_dir(dir.path());
        let ids: Vec<_> = s.frameworks.iter().map(|f| f.profile_id).collect();
        assert_eq!(ids, vec!["fastapi", "gin"]);
        assert_eq!(s.languages[0].id, "python");
        assert!(s.test_runners.iter().any(|t| t.runner == "pytest"));
        assert!(s.toolchains.iter().any(|t| t.id == "go"));
    }

    #[test]
    fn detects_node_when_asked() {
        // Node is required to develop KnYC itself, so it's installed wherever tests run.
        assert!(
            installed_version("node").is_some_and(|v| v.chars().next().unwrap().is_ascii_digit())
        );
        assert_eq!(installed_version("not-a-toolchain"), None);
        // KnYC's own development needs npm (through pnpm's Node) and git.
        for id in ["npm", "git"] {
            let version = installed_version(id);
            assert!(
                version
                    .as_deref()
                    .is_some_and(|v| v.chars().next().unwrap().is_ascii_digit()),
                "{id}: {version:?}"
            );
        }
    }
}
