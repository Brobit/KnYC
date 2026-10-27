//! Stage ③: code graph (design/02-analysis-pipeline.md ③). Files, imports, exports, symbols,
//! file and symbol dependencies, cycles, and layers from leaves to entry points.
//! TypeScript and JavaScript for now; other languages come with their profiles.

pub mod parse;

use crate::walk::{Walk, walk};
use parse::{Lang, ParsedFile, Symbol};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub files: Vec<FileNode>,
    /// File → file dependencies (local imports only).
    pub edges: Vec<Edge>,
    /// Symbol → symbol dependencies, as unit ids ("src/a.ts#Foo" → "src/b.ts#Bar").
    pub symbol_edges: Vec<(String, String)>,
    /// Groups of files that import each other. Each group is taught together.
    pub cycles: Vec<Vec<String>>,
    /// Non-test files from leaves (layer 0, no local dependencies) to entry points.
    pub layers: Vec<Vec<String>>,
    /// External package → files importing it.
    pub external: BTreeMap<String, Vec<String>>,
    /// Relative imports that point to no file (generated code, path aliases…).
    pub unresolved: Vec<Unresolved>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub path: String,
    pub language: &'static str,
    pub loc: usize,
    pub test: bool,
    pub parse_errors: bool,
    pub imports: Vec<FileImport>,
    pub exports: Vec<String>,
    pub symbols: Vec<Symbol>,
    /// Members the file adds to other types (module augmentation).
    #[serde(skip)]
    pub augments: BTreeSet<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileImport {
    pub specifier: String,
    /// Local file this import points to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved: Option<String>,
    /// Package name for non-relative imports ("express", "@nestjs/core", "node:fs").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
    pub names: Vec<String>,
    pub type_only: bool,
    pub reexport: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub type_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unresolved {
    pub file: String,
    pub specifier: String,
}

pub fn is_test_file(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    path.split('/')
        .any(|dir| matches!(dir, "test" | "tests" | "__tests__" | "e2e"))
        || name.contains(".test.")
        || name.contains(".spec.")
}

pub fn build(root: &Path) -> anyhow::Result<Graph> {
    from_walk(&walk(root)?)
}

pub fn from_walk(walked: &Walk) -> anyhow::Result<Graph> {
    let known: BTreeSet<&str> = walked.files.iter().map(|f| f.path.as_str()).collect();

    let mut files = Vec::new();
    for file in walked.ai_files() {
        let Some(lang) = Lang::from_path(&file.path) else {
            continue;
        };
        if file.path.ends_with(".d.ts") {
            continue;
        }
        let source = std::fs::read_to_string(&file.abs)?;
        let ParsedFile {
            imports,
            exports,
            symbols,
            has_errors,
            augments,
        } = parse::parse(lang, &source)?;
        let imports = imports
            .into_iter()
            .map(|i| {
                let (resolved, package) =
                    if i.specifier.starts_with('.') || i.specifier.starts_with('/') {
                        (resolve(&file.path, &i.specifier, &known), None)
                    } else {
                        (None, Some(package_name(&i.specifier)))
                    };
                FileImport {
                    specifier: i.specifier,
                    resolved,
                    package,
                    names: i.names,
                    type_only: i.type_only,
                    reexport: i.reexport,
                }
            })
            .collect();
        files.push(FileNode {
            path: file.path.clone(),
            language: lang.id(),
            loc: file.lines,
            test: is_test_file(&file.path),
            parse_errors: has_errors,
            imports,
            exports,
            symbols,
            augments,
        });
    }

    let mut edges = BTreeSet::new();
    let mut external: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut unresolved = Vec::new();
    for file in &files {
        for import in &file.imports {
            match (&import.resolved, &import.package) {
                (Some(to), _) if to != &file.path => {
                    edges.insert(Edge {
                        from: file.path.clone(),
                        to: to.clone(),
                        type_only: import.type_only,
                    });
                }
                (None, Some(package)) => {
                    external
                        .entry(package.clone())
                        .or_default()
                        .insert(file.path.clone());
                }
                (None, None) => unresolved.push(Unresolved {
                    file: file.path.clone(),
                    specifier: import.specifier.clone(),
                }),
                _ => {}
            }
        }
    }
    // The same file imported twice (value + type) is one dependency; keep the value one.
    let mut edges: Vec<Edge> = edges.into_iter().collect();
    edges.dedup_by(|b, a| {
        if a.from == b.from && a.to == b.to {
            a.type_only &= b.type_only;
            true
        } else {
            false
        }
    });

    let symbol_edges = symbol_edges(&files);
    let (cycles, layers) = layers(&files, &edges);

    Ok(Graph {
        files,
        edges,
        symbol_edges,
        cycles,
        layers,
        external: external
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().collect()))
            .collect(),
        unresolved,
    })
}

/// "@scope/pkg/sub" → "@scope/pkg", "express/router" → "express", "node:fs" → "node:fs".
fn package_name(specifier: &str) -> String {
    let mut parts = specifier.split('/');
    let first = parts.next().unwrap_or_default();
    if first.starts_with('@')
        && let Some(second) = parts.next()
    {
        return format!("{first}/{second}");
    }
    first.to_string()
}

fn normalize(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            p => out.push(p),
        }
    }
    out.join("/")
}

/// Resolves a relative import like Node/TypeScript do: "./x.js" may be "./x.ts" in the source,
/// extensions are optional, and a folder means its index file.
fn resolve(from: &str, specifier: &str, known: &BTreeSet<&str>) -> Option<String> {
    let dir = from.rsplit_once('/').map_or("", |(d, _)| d);
    let base = normalize(&format!("{dir}/{specifier}"));
    const EXTS: &[&str] = &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

    let mut candidates = Vec::new();
    if let Some((stem, ext)) = base.rsplit_once('.') {
        let ts_twin = match ext {
            "js" => Some(["ts", "tsx"].as_slice()),
            "jsx" => Some(["tsx"].as_slice()),
            "mjs" => Some(["mts"].as_slice()),
            "cjs" => Some(["cts"].as_slice()),
            _ => None,
        };
        if let Some(twins) = ts_twin {
            candidates.extend(twins.iter().map(|t| format!("{stem}.{t}")));
        }
    }
    candidates.push(base.clone());
    candidates.extend(EXTS.iter().map(|e| format!("{base}.{e}")));
    candidates.extend(EXTS.iter().map(|e| format!("{base}/index.{e}")));
    candidates.into_iter().find(|c| known.contains(c.as_str()))
}

fn symbol_edges(files: &[FileNode]) -> Vec<(String, String)> {
    let by_path: HashMap<&str, &FileNode> = files.iter().map(|f| (f.path.as_str(), f)).collect();
    let mut edges = BTreeSet::new();
    for file in files {
        // Local name → (file, symbol) it refers to.
        let mut scope: HashMap<&str, (&str, &str)> = HashMap::new();
        for import in &file.imports {
            let Some(target) = import.resolved.as_deref().and_then(|p| by_path.get(p)) else {
                continue;
            };
            for name in &import.names {
                if let Some(sym) = target.symbols.iter().find(|s| &s.name == name) {
                    scope.insert(name, (target.path.as_str(), sym.name.as_str()));
                }
            }
        }
        for sym in file.symbols.iter().filter(|s| !s.name.contains('.')) {
            scope.insert(&sym.name, (file.path.as_str(), sym.name.as_str()));
        }
        let is_class = |path: &str, name: &str| {
            by_path.get(path).is_some_and(|f| {
                f.symbols
                    .iter()
                    .any(|s| s.name == name && s.kind == parse::SymbolKind::Class)
            })
        };
        for sym in &file.symbols {
            let from = format!("{}#{}", file.path, sym.name);
            let owner = sym.name.split('.').next().unwrap_or(&sym.name);
            for used in &sym.uses {
                if let Some((path, target)) = scope.get(used.as_str())
                    && !(*path == file.path && (*target == sym.name || *target == owner))
                {
                    edges.insert((from.clone(), format!("{path}#{target}")));
                }
            }

            // Method calls: `this.products.reserveStock()` → ProductsService.reserveStock.
            // Candidate classes: those this symbol uses, those its class uses (constructor
            // parameter types), and its own class.
            let owner_sym = file.symbols.iter().find(|s| s.name == owner);
            let mut classes: BTreeSet<(&str, &str)> = sym
                .uses
                .iter()
                .chain(owner_sym.into_iter().flat_map(|o| o.uses.iter()))
                .filter_map(|name| scope.get(name.as_str()).copied())
                .filter(|(path, name)| is_class(path, name))
                .collect();
            if sym.name.contains('.') {
                classes.insert((file.path.as_str(), owner));
            }
            for member in &sym.members {
                for (path, class) in &classes {
                    let method = format!("{class}.{member}");
                    let exists = by_path.get(path).is_some_and(|f| {
                        f.symbols
                            .iter()
                            .any(|s| s.name == method && s.kind == parse::SymbolKind::Method)
                    });
                    if exists && !(*path == file.path && method == sym.name) {
                        edges.insert((from.clone(), format!("{path}#{method}")));
                    }
                }
            }
        }
    }
    // Module augmentation: `app.links` exists because a plugin's `declare module "fastify"` adds
    // it and the plugin decorates the app with it, so what uses the member needs that file's code
    // (its exported functions, classes and values). A file that imports it is already ordered
    // after it, and `this.links` is the class's own field.
    for file in files {
        let imported: BTreeSet<&str> = file
            .imports
            .iter()
            .filter_map(|i| i.resolved.as_deref())
            .collect();
        for sym in &file.symbols {
            for other in files
                .iter()
                .filter(|o| o.path != file.path && !o.test && !imported.contains(o.path.as_str()))
            {
                if !sym.outer_members.iter().any(|m| other.augments.contains(m)) {
                    continue;
                }
                let from = format!("{}#{}", file.path, sym.name);
                for target in other.symbols.iter().filter(|t| {
                    t.exported
                        && !t.name.contains('.')
                        && matches!(
                            t.kind,
                            parse::SymbolKind::Function
                                | parse::SymbolKind::Class
                                | parse::SymbolKind::Variable
                        )
                }) {
                    edges.insert((from.clone(), format!("{}#{}", other.path, target.name)));
                }
            }
        }
    }
    edges.into_iter().collect()
}

/// Tarjan's strongly connected components, then the longest path to a leaf as the layer.
fn layers(files: &[FileNode], edges: &[Edge]) -> (Vec<Vec<String>>, Vec<Vec<String>>) {
    let nodes: Vec<&str> = files
        .iter()
        .filter(|f| !f.test)
        .map(|f| f.path.as_str())
        .collect();
    let index: HashMap<&str, usize> = nodes.iter().enumerate().map(|(i, n)| (*n, i)).collect();
    let mut adj = vec![Vec::new(); nodes.len()];
    for e in edges {
        if let (Some(&a), Some(&b)) = (index.get(e.from.as_str()), index.get(e.to.as_str())) {
            adj[a].push(b);
        }
    }

    struct Tarjan<'a> {
        adj: &'a [Vec<usize>],
        index: Vec<Option<usize>>,
        low: Vec<usize>,
        on_stack: Vec<bool>,
        stack: Vec<usize>,
        next: usize,
        components: Vec<Vec<usize>>,
    }
    impl Tarjan<'_> {
        fn visit(&mut self, v: usize) {
            self.index[v] = Some(self.next);
            self.low[v] = self.next;
            self.next += 1;
            self.stack.push(v);
            self.on_stack[v] = true;
            for i in 0..self.adj[v].len() {
                let w = self.adj[v][i];
                match self.index[w] {
                    None => {
                        self.visit(w);
                        self.low[v] = self.low[v].min(self.low[w]);
                    }
                    Some(wi) if self.on_stack[w] => self.low[v] = self.low[v].min(wi),
                    _ => {}
                }
            }
            if Some(self.low[v]) == self.index[v] {
                let mut component = Vec::new();
                while let Some(w) = self.stack.pop() {
                    self.on_stack[w] = false;
                    component.push(w);
                    if w == v {
                        break;
                    }
                }
                self.components.push(component);
            }
        }
    }
    let n = nodes.len();
    let mut t = Tarjan {
        adj: &adj,
        index: vec![None; n],
        low: vec![0; n],
        on_stack: vec![false; n],
        stack: Vec::new(),
        next: 0,
        components: Vec::new(),
    };
    for v in 0..n {
        if t.index[v].is_none() {
            t.visit(v);
        }
    }

    // Tarjan emits components in reverse topological order: dependencies come first.
    let mut component_of = vec![0; n];
    for (c, members) in t.components.iter().enumerate() {
        for &m in members {
            component_of[m] = c;
        }
    }
    let mut layer_of = vec![0usize; t.components.len()];
    for (c, members) in t.components.iter().enumerate() {
        layer_of[c] = members
            .iter()
            .flat_map(|&m| &adj[m])
            .map(|&w| component_of[w])
            .filter(|&d| d != c)
            .map(|d| layer_of[d] + 1)
            .max()
            .unwrap_or(0);
    }

    let mut layers: Vec<Vec<String>> = Vec::new();
    for (c, members) in t.components.iter().enumerate() {
        let layer = layer_of[c];
        if layers.len() <= layer {
            layers.resize(layer + 1, Vec::new());
        }
        layers[layer].extend(members.iter().map(|&m| nodes[m].to_string()));
    }
    for layer in &mut layers {
        layer.sort();
    }
    let mut cycles: Vec<Vec<String>> = t
        .components
        .iter()
        .filter(|members| members.len() > 1)
        .map(|members| {
            let mut c: Vec<String> = members.iter().map(|&m| nodes[m].to_string()).collect();
            c.sort();
            c
        })
        .collect();
    cycles.sort();
    (cycles, layers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn project(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (path, content) in files {
            let full = dir.path().join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, content).unwrap();
        }
        dir
    }

    #[test]
    fn resolves_imports_like_node_and_typescript() {
        let known: BTreeSet<&str> = ["src/a.ts", "src/lib/index.ts", "src/view.tsx", "src/raw.js"]
            .into_iter()
            .collect();
        assert_eq!(
            resolve("src/b.ts", "./a.js", &known).as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(
            resolve("src/b.ts", "./a", &known).as_deref(),
            Some("src/a.ts")
        );
        assert_eq!(
            resolve("src/b.ts", "./lib", &known).as_deref(),
            Some("src/lib/index.ts")
        );
        assert_eq!(
            resolve("src/x/b.ts", "../view.js", &known).as_deref(),
            Some("src/view.tsx")
        );
        assert_eq!(
            resolve("src/b.ts", "./raw.js", &known).as_deref(),
            Some("src/raw.js")
        );
        assert_eq!(resolve("src/b.ts", "./missing", &known), None);
        assert_eq!(package_name("@nestjs/core/injector"), "@nestjs/core");
        assert_eq!(package_name("express"), "express");
    }

    #[test]
    fn module_augmentations_order_what_uses_them() {
        let dir = project(&[
            (
                "src/store.ts",
                "export class LinksStore { private links = new Map(); size() { return this.links.size; } }
",
            ),
            (
                "src/plugin.ts",
                "import { LinksStore } from './store.js';
declare module 'fastify' { interface FastifyInstance { links: LinksStore } }
export const storePlugin = async (app: any) => { app.decorate('links', new LinksStore()); };
",
            ),
            (
                "src/routes.ts",
                "export const routes = async (app: any) => { app.get('/', async () => app.links.size()); };
",
            ),
        ]);
        let g = build(dir.path()).unwrap();
        // The routes use app.links, which only the plugin adds.
        assert!(g.symbol_edges.contains(&(
            "src/routes.ts#routes".into(),
            "src/plugin.ts#storePlugin".into()
        )));
        // this.links is the store's own field, not the augmented member.
        assert!(
            !g.symbol_edges
                .iter()
                .any(|(from, to)| from.starts_with("src/store.ts")
                    && to.starts_with("src/plugin.ts"))
        );
    }

    #[test]
    fn layers_cycles_and_symbol_edges() {
        let dir = project(&[
            ("src/types.ts", "export interface User { id: string }\n"),
            (
                "src/a.ts",
                "import { b } from './b.js';\nexport const a = () => b();\n",
            ),
            (
                "src/b.ts",
                "import { a } from './a.js';\nexport const b = () => a();\n",
            ),
            (
                "src/service.ts",
                "import type { User } from './types.js';\nimport { a } from './a.js';\nexport function load(u: User) { return a(); }\nexport function unused() {}\n",
            ),
            (
                "src/main.ts",
                "import { load } from './service.js';\nimport express from 'express';\nload({ id: '1' });\n",
            ),
            (
                "tests/service.test.ts",
                "import { load } from '../src/service.js';\n",
            ),
            ("src/broken.ts", "import x from './generated/client.js';\n"),
        ]);
        let g = build(dir.path()).unwrap();

        assert_eq!(
            g.cycles,
            vec![vec!["src/a.ts".to_string(), "src/b.ts".to_string()]]
        );
        assert_eq!(
            g.layers,
            vec![
                vec!["src/a.ts", "src/b.ts", "src/broken.ts", "src/types.ts"],
                vec!["src/service.ts"],
                vec!["src/main.ts"],
            ]
        );
        assert!(
            g.symbol_edges
                .contains(&("src/service.ts#load".into(), "src/types.ts#User".into()))
        );
        assert!(
            g.symbol_edges
                .contains(&("src/service.ts#load".into(), "src/a.ts#a".into()))
        );
        assert!(
            !g.symbol_edges
                .iter()
                .any(|(from, _)| from == "src/service.ts#unused")
        );
        assert_eq!(
            g.external.get("express"),
            Some(&vec!["src/main.ts".to_string()])
        );
        assert_eq!(g.unresolved.len(), 1);
        assert!(
            g.files
                .iter()
                .find(|f| f.path == "tests/service.test.ts")
                .unwrap()
                .test
        );
        let type_edge = g.edges.iter().find(|e| e.to == "src/types.ts").unwrap();
        assert!(type_edge.type_only);
    }

    #[test]
    fn test_files() {
        for p in [
            "tests/a.ts",
            "src/a.test.ts",
            "src/__tests__/a.ts",
            "src/a.spec.tsx",
        ] {
            assert!(is_test_file(p), "{p}");
        }
        for p in ["src/testing-utils.ts", "src/contest.ts"] {
            assert!(!is_test_file(p), "{p}");
        }
    }
}
