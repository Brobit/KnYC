//! Python (#126): imports, top-level symbols and what each uses, from tree-sitter-python. Imports
//! are module paths as written ("app.models", ".models", ".."); the graph resolves them to files.

use super::parse::{Import, ParsedFile, Symbol, SymbolKind, symbol_at, text};
use std::collections::BTreeSet;
use tree_sitter::{Node, Parser};

pub fn parse_python(source: &str) -> anyhow::Result<ParsedFile> {
    let mut parser = Parser::new();
    parser.set_language(&tree_sitter_python::LANGUAGE.into())?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| anyhow::anyhow!("tree-sitter could not parse the file"))?;
    let root = tree.root_node();
    let src = source.as_bytes();
    let mut file = ParsedFile {
        has_errors: root.has_error(),
        ..ParsedFile::default()
    };
    // Imports anywhere: inside a function or a `try` they're still what the file needs.
    imports(root, src, &mut file.imports);

    let mut all: Option<Vec<String>> = None;
    let mut cursor = root.walk();
    for node in root.named_children(&mut cursor) {
        definition(node, src, &mut file.symbols, &mut all);
    }
    for symbol in &mut file.symbols {
        let owner = symbol.name.split('.').next().unwrap_or(&symbol.name);
        symbol.exported = match &all {
            Some(names) => names.iter().any(|n| n == owner),
            None => !owner.starts_with('_'),
        };
    }
    file.exports = file
        .symbols
        .iter()
        .filter(|s| s.exported && !s.name.contains('.'))
        .map(|s| s.name.clone())
        .collect();
    Ok(file)
}

fn imports(node: Node, src: &[u8], out: &mut Vec<Import>) {
    let import = |specifier: String, names: Vec<String>, module: bool| Import {
        specifier,
        names,
        type_only: false,
        reexport: false,
        module,
    };
    match node.kind() {
        // import a.b, c as d
        "import_statement" => {
            let mut cursor = node.walk();
            for name in node.children_by_field_name("name", &mut cursor) {
                let (module, bound) = match name.kind() {
                    "aliased_import" => {
                        let module = name.child_by_field_name("name").map(|n| text(n, src));
                        let alias = name.child_by_field_name("alias").map(|n| text(n, src));
                        (module.unwrap_or_default(), alias.unwrap_or_default())
                    }
                    // `import a.b` binds `a`; its uses are `a.b.f()`.
                    _ => (text(name, src), text(name, src).split('.').next().unwrap()),
                };
                out.push(import(module.to_string(), vec![bound.to_string()], true));
            }
        }
        // from .models import Note, create as make / from . import routes / from x import *
        "import_from_statement" => {
            let Some(module) = node.child_by_field_name("module_name") else {
                return;
            };
            let mut names = Vec::new();
            let mut cursor = node.walk();
            for name in node.children_by_field_name("name", &mut cursor) {
                let imported = match name.kind() {
                    "aliased_import" => name.child_by_field_name("name"),
                    _ => Some(name),
                };
                names.extend(imported.map(|n| text(n, src).to_string()));
            }
            if names.is_empty() {
                names.push("*".into());
            }
            out.push(import(
                text(module, src).split_whitespace().collect(),
                names,
                false,
            ));
        }
        _ => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                imports(child, src, out);
            }
        }
    }
}

/// A top-level statement: a function, a class (its methods as `Class.method`), an assignment
/// (`router = APIRouter()`), `__all__`. Decorators are part of what they decorate.
fn definition(node: Node, src: &[u8], symbols: &mut Vec<Symbol>, all: &mut Option<Vec<String>>) {
    let (definition, start) = match node.kind() {
        "decorated_definition" => match node.child_by_field_name("definition") {
            Some(d) => (d, node),
            None => return,
        },
        _ => (node, node),
    };
    let name = definition
        .child_by_field_name("name")
        .map(|n| text(n, src).to_string());
    match definition.kind() {
        "function_definition" => {
            if let Some(name) = name {
                symbols.push(symbol(&name, SymbolKind::Function, start, src));
            }
        }
        "class_definition" => {
            let Some(name) = name else { return };
            symbols.push(symbol(&name, SymbolKind::Class, start, src));
            if let Some(body) = definition.child_by_field_name("body") {
                let mut cursor = body.walk();
                for member in body.named_children(&mut cursor) {
                    let (inner, member_start) = match member.kind() {
                        "decorated_definition" => match member.child_by_field_name("definition") {
                            Some(d) => (d, member),
                            None => continue,
                        },
                        _ => (member, member),
                    };
                    if inner.kind() != "function_definition" {
                        continue;
                    }
                    if let Some(method) = inner.child_by_field_name("name") {
                        let full = format!("{name}.{}", text(method, src));
                        symbols.push(symbol(&full, SymbolKind::Method, member_start, src));
                    }
                }
            }
        }
        "type_alias_statement" => {
            let left = definition.child_by_field_name("left");
            if let Some(name) = left.map(|n| text(n, src).to_string()) {
                symbols.push(symbol(&name, SymbolKind::Type, start, src));
            }
        }
        "expression_statement" => {
            let Some(assignment) = definition
                .named_child(0)
                .filter(|a| a.kind() == "assignment")
            else {
                return;
            };
            let Some(left) = assignment.child_by_field_name("left") else {
                return;
            };
            let mut targets = Vec::new();
            match left.kind() {
                "identifier" => targets.push(text(left, src).to_string()),
                // a, b = …
                "pattern_list" | "tuple_pattern" => {
                    let mut cursor = left.walk();
                    targets.extend(
                        left.named_children(&mut cursor)
                            .filter(|n| n.kind() == "identifier")
                            .map(|n| text(n, src).to_string()),
                    );
                }
                _ => return,
            }
            if targets == ["__all__"] {
                *all = assignment
                    .child_by_field_name("right")
                    .map(|r| strings(r, src));
                return;
            }
            for target in targets {
                // Dunders (`__version__`) and constants alike: a value the code may use.
                symbols.push(symbol(&target, SymbolKind::Variable, start, src));
            }
        }
        _ => {}
    }
}

/// The string literals in `["a", "b"]`.
fn strings(node: Node, src: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if child.kind() == "string" {
            let mut c = child.walk();
            out.extend(
                child
                    .named_children(&mut c)
                    .filter(|n| n.kind() == "string_content")
                    .map(|n| text(n, src).to_string()),
            );
        }
    }
    out
}

fn symbol(name: &str, kind: SymbolKind, node: Node, src: &[u8]) -> Symbol {
    let mut uses = BTreeSet::new();
    let mut members = BTreeSet::new();
    collect(node, src, &mut uses, &mut members);
    uses.remove(name.split('.').next_back().unwrap_or(name));
    symbol_at(name, kind, false, node, uses, members)
}

/// Identifiers used, and attributes (`db.add`, `self.repo.save`) as members.
fn collect(node: Node, src: &[u8], uses: &mut BTreeSet<String>, members: &mut BTreeSet<String>) {
    match node.kind() {
        "identifier" => {
            uses.insert(text(node, src).to_string());
        }
        "attribute" => {
            if let Some(attribute) = node.child_by_field_name("attribute") {
                members.insert(text(attribute, src).to_string());
            }
            // The attribute's own name isn't a variable: only the object is walked.
            if let Some(object) = node.child_by_field_name("object") {
                collect(object, src, uses, members);
            }
            return;
        }
        // Keyword arguments name parameters, not variables: `Field(default=…)`.
        "keyword_argument" => {
            if let Some(value) = node.child_by_field_name("value") {
                collect(value, src, uses, members);
            }
            return;
        }
        // `@router.get("/")` uses `router`; its `get` isn't a call of a method of the code.
        "decorator" => {
            let mut ignored = BTreeSet::new();
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                collect(child, src, uses, &mut ignored);
            }
            return;
        }
        // A function's parameters and local variables shadow the module's names: `app` inside
        // `create_app` isn't the module-level `app`.
        "function_definition" | "lambda" => {
            let mut inner = BTreeSet::new();
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                collect(child, src, &mut inner, members);
            }
            let mut locals = BTreeSet::new();
            if let Some(parameters) = node.child_by_field_name("parameters") {
                parameter_names(parameters, src, &mut locals);
            }
            if let Some(body) = node.child_by_field_name("body") {
                assigned(body, src, &mut locals);
            }
            uses.extend(inner.difference(&locals).cloned());
            return;
        }
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect(child, src, uses, members);
    }
}

/// The names a function's parameters bind (not their annotations or defaults, which are uses).
fn parameter_names(parameters: Node, src: &[u8], out: &mut BTreeSet<String>) {
    let mut cursor = parameters.walk();
    for parameter in parameters.named_children(&mut cursor) {
        let name = match parameter.kind() {
            "identifier" => Some(parameter),
            "default_parameter" | "typed_default_parameter" => {
                parameter.child_by_field_name("name")
            }
            // `x: int`, `*args`, `**kwargs`: the identifier comes first.
            _ => parameter.named_child(0).and_then(|n| match n.kind() {
                "identifier" => Some(n),
                _ => n.named_child(0).filter(|n| n.kind() == "identifier"),
            }),
        };
        out.extend(name.map(|n| text(n, src).to_string()));
    }
}

/// Names bound in a function's body: assignments, `for` targets, `with … as`, `except … as`,
/// `:=`, comprehension variables, nested functions and classes. Nested scopes aren't entered.
fn assigned(node: Node, src: &[u8], out: &mut BTreeSet<String>) {
    let targets: &[&str] = match node.kind() {
        "assignment" | "augmented_assignment" | "for_statement" | "for_in_clause" => &["left"],
        "named_expression" => &["name"],
        "as_pattern" => &["alias"],
        "function_definition" | "class_definition" => {
            out.extend(
                node.child_by_field_name("name")
                    .map(|n| text(n, src).to_string()),
            );
            return;
        }
        _ => &[],
    };
    for field in targets {
        if let Some(target) = node.child_by_field_name(field) {
            bound(target, src, out);
        }
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        assigned(child, src, out);
    }
}

/// The identifiers a target binds: `x`, `a, b`, `[a, (b, c)]`; not `self.x` or `d[k]`.
fn bound(target: Node, src: &[u8], out: &mut BTreeSet<String>) {
    match target.kind() {
        "identifier" => {
            out.insert(text(target, src).to_string());
        }
        "attribute" | "subscript" => {}
        _ => {
            let mut cursor = target.walk();
            for child in target.named_children(&mut cursor) {
                bound(child, src, out);
            }
        }
    }
}

/// Where Python looks for the project's top-level packages: the project root, `src/`, and each
/// folder holding a `pyproject.toml`, `setup.py` or `requirements.txt` (a package of a monorepo).
pub fn roots(known: &BTreeSet<&str>) -> Vec<String> {
    let mut roots: BTreeSet<String> = ["".to_string()].into();
    for path in known {
        let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
        if matches!(name, "pyproject.toml" | "setup.py" | "requirements.txt") {
            roots.insert(dir.to_string());
        }
    }
    for root in roots.clone() {
        let src = if root.is_empty() {
            "src".to_string()
        } else {
            format!("{root}/src")
        };
        if known.iter().any(|p| p.starts_with(&format!("{src}/"))) {
            roots.insert(src);
        }
    }
    roots.into_iter().collect()
}

/// The file of module `specifier` imported from `from`: "app.models" → "app/models.py" or
/// "app/models/__init__.py" under one of the roots; ".models" and "..core" from the importing
/// file's package.
pub fn resolve(
    from: &str,
    specifier: &str,
    known: &BTreeSet<&str>,
    roots: &[String],
) -> Option<String> {
    let file = |base: &str| {
        [format!("{base}.py"), format!("{base}/__init__.py")]
            .into_iter()
            .find(|c| known.contains(c.as_str()))
    };
    let dots = specifier.len() - specifier.trim_start_matches('.').len();
    let rest = specifier[dots..].replace('.', "/");
    if dots > 0 {
        let mut dir: Vec<&str> = from.split('/').collect();
        dir.pop();
        for _ in 1..dots {
            dir.pop()?;
        }
        let dir = dir.join("/");
        let base = match (dir.is_empty(), rest.is_empty()) {
            (_, true) => return file(&dir),
            (true, false) => rest,
            (false, false) => format!("{dir}/{rest}"),
        };
        return file(&base);
    }
    roots.iter().find_map(|root| {
        file(&if root.is_empty() {
            rest.clone()
        } else {
            format!("{root}/{rest}")
        })
    })
}

/// The project's own top-level packages and modules, so an import of one that doesn't resolve is
/// reported, not taken for a library.
pub fn local_tops(known: &BTreeSet<&str>, roots: &[String]) -> BTreeSet<String> {
    let mut tops = BTreeSet::new();
    for path in known.iter().filter(|p| p.ends_with(".py")) {
        for root in roots {
            let inside = if root.is_empty() {
                Some(*path)
            } else {
                path.strip_prefix(&format!("{root}/"))
            };
            if let Some(inside) = inside {
                let top = inside.split('/').next().unwrap_or(inside);
                tops.insert(top.trim_end_matches(".py").to_string());
            }
        }
    }
    tops
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
"""Notes routes."""
from __future__ import annotations
import os
import app.db as database
from fastapi import APIRouter, Depends, HTTPException
from .models import Note, NoteIn as In
from . import store
from ..core.settings import get_settings

__all__ = ["router", "create_note", "NotesService"]

router = APIRouter(prefix="/notes")
_cache = {}

class NotesService:
    def __init__(self, repo):
        self.repo = repo

    @property
    def count(self):
        return len(self.repo.all())

    def add(self, text: str) -> Note:
        return self.repo.save(Note(text=text))

@router.post("/", status_code=201)
async def create_note(body: In, service: NotesService = Depends(store.service)) -> Note:
    if not body.text:
        raise HTTPException(status_code=400)
    return service.add(body.text)

def _helper():
    try:
        import json
    except ImportError:
        pass
    return database.connect(os.environ["DB"])
"#;

    #[test]
    fn imports_symbols_and_exports() {
        let f = parse_python(SAMPLE).unwrap();
        assert!(!f.has_errors);
        let imports: Vec<_> = f
            .imports
            .iter()
            .map(|i| (i.specifier.as_str(), i.names.join(","), i.module))
            .collect();
        assert_eq!(
            imports,
            [
                ("os", "os".into(), true),
                ("app.db", "database".into(), true),
                ("fastapi", "APIRouter,Depends,HTTPException".into(), false),
                (".models", "Note,NoteIn".into(), false),
                (".", "store".into(), false),
                ("..core.settings", "get_settings".into(), false),
                ("json", "json".into(), true),
            ]
        );
        let names: Vec<_> = f
            .symbols
            .iter()
            .map(|s| (s.name.as_str(), s.kind, s.exported))
            .collect();
        assert_eq!(
            names,
            [
                ("router", SymbolKind::Variable, true),
                ("_cache", SymbolKind::Variable, false),
                ("NotesService", SymbolKind::Class, true),
                ("NotesService.__init__", SymbolKind::Method, true),
                ("NotesService.count", SymbolKind::Method, true),
                ("NotesService.add", SymbolKind::Method, true),
                ("create_note", SymbolKind::Function, true),
                ("_helper", SymbolKind::Function, false),
            ]
        );
        assert_eq!(f.exports, ["router", "NotesService", "create_note"]);

        let create = f.symbols.iter().find(|s| s.name == "create_note").unwrap();
        // The decorator is part of the function, and what it uses.
        assert_eq!(create.start_line, 27);
        for used in [
            "router",
            "In",
            "NotesService",
            "Depends",
            "store",
            "HTTPException",
        ] {
            assert!(create.uses.contains(used), "{used}: {:?}", create.uses);
        }
        assert!(
            !create.uses.contains("status_code"),
            "keyword names aren't uses"
        );
        assert!(create.members.contains("add") && create.members.contains("service"));
        let add = f
            .symbols
            .iter()
            .find(|s| s.name == "NotesService.add")
            .unwrap();
        assert!(add.members.contains("save") && add.uses.contains("Note"));
    }

    #[test]
    fn locals_shadow_module_names_and_decorators_call_nothing() {
        let f = parse_python(
            "app = None
limit = 3

@router.get(\"/\")
def create_app(limit: int = limit, *args, **kw):
    app = FastAPI()
    for i, (a, b) in enumerate(x):
        pass
    with open(p) as handle:
        pass
    try:
        pass
    except KeyError as error:
        pass
    total = [n for n in range(limit)]
    def inner():
        return app
    return app.mount(inner, handle, error, total, args, kw, i, a, b, n)
",
        )
        .unwrap();
        let create = f.symbols.iter().find(|s| s.name == "create_app").unwrap();
        let uses: Vec<_> = create.uses.iter().map(String::as_str).collect();
        // A parameter shadows the module's name even in its own default (`limit: int = limit`):
        // rare, and only an ordering hint is lost.
        assert_eq!(
            uses,
            [
                "FastAPI",
                "KeyError",
                "enumerate",
                "int",
                "open",
                "p",
                "range",
                "router",
                "x"
            ]
        );
        assert!(!create.members.contains("get"), "{:?}", create.members);
        assert!(create.members.contains("mount"));
    }

    #[test]
    fn resolves_modules_like_python() {
        let known: BTreeSet<&str> = [
            "pyproject.toml",
            "src/app/__init__.py",
            "src/app/main.py",
            "src/app/notes/__init__.py",
            "src/app/notes/routes.py",
            "src/app/notes/models.py",
            "src/app/core/settings.py",
            "tests/conftest.py",
        ]
        .into();
        let roots = roots(&known);
        assert_eq!(roots, ["", "src"]);
        let r = |from: &str, spec: &str| resolve(from, spec, &known, &roots);
        assert_eq!(
            r("src/app/main.py", "app.notes.routes").as_deref(),
            Some("src/app/notes/routes.py")
        );
        assert_eq!(
            r("src/app/main.py", "app.notes").as_deref(),
            Some("src/app/notes/__init__.py")
        );
        assert_eq!(
            r("src/app/notes/routes.py", ".models").as_deref(),
            Some("src/app/notes/models.py")
        );
        assert_eq!(
            r("src/app/notes/routes.py", ".").as_deref(),
            Some("src/app/notes/__init__.py")
        );
        assert_eq!(
            r("src/app/notes/routes.py", "..core.settings").as_deref(),
            Some("src/app/core/settings.py")
        );
        assert_eq!(r("src/app/main.py", "fastapi"), None);
        assert_eq!(
            local_tops(&known, &roots),
            ["app", "src", "tests"].map(String::from).into()
        );
    }
}
