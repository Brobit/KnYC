//! Per-file facts from tree-sitter: imports, exports and top-level symbols, plus the identifiers
//! each symbol uses (for symbol-level dependencies).

use serde::Serialize;
use std::collections::BTreeSet;
use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    TypeScript,
    Tsx,
    JavaScript,
}

impl Lang {
    pub fn from_path(path: &str) -> Option<Self> {
        let ext = path.rsplit_once('.')?.1;
        match ext {
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            "js" | "jsx" | "mjs" | "cjs" => Some(Self::JavaScript),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::TypeScript | Self::Tsx => "typescript",
            Self::JavaScript => "javascript",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Import {
    /// As written: "./notes.store.js", "express".
    pub specifier: String,
    /// Local names bound by this import ("*" for a side-effect import).
    pub names: Vec<String>,
    pub type_only: bool,
    /// `export … from` re-exports are imports too.
    pub reexport: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SymbolKind {
    Function,
    Class,
    Method,
    Field,
    Interface,
    Type,
    Enum,
    Variable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    /// "notesRouter", "NotesStore", "NotesStore.create".
    pub name: String,
    pub kind: SymbolKind,
    pub exported: bool,
    /// 1-based, inclusive.
    pub start_line: usize,
    pub end_line: usize,
    /// Identifiers used inside the symbol (filtered later to known names).
    #[serde(skip)]
    pub uses: BTreeSet<String>,
    /// Member names used inside the symbol (`x.reserveStock`, `this.getForUser`), to link calls to
    /// methods of the classes it depends on.
    #[serde(skip)]
    pub members: BTreeSet<String>,
    /// Members used on other objects than `this` (`app.links`), for module augmentations.
    #[serde(skip)]
    pub outer_members: BTreeSet<String>,
}

#[derive(Debug, Default)]
pub struct ParsedFile {
    pub imports: Vec<Import>,
    pub exports: Vec<String>,
    pub symbols: Vec<Symbol>,
    pub has_errors: bool,
    /// Members this file adds to other types through `declare module "x" { interface … }` or
    /// `declare global` (Fastify's `app.links`, Express's `req.user`).
    pub augments: BTreeSet<String>,
}

pub fn parse(lang: Lang, source: &str) -> anyhow::Result<ParsedFile> {
    let mut parser = Parser::new();
    let language = match lang {
        Lang::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
        Lang::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
    };
    parser.set_language(&language)?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| anyhow::anyhow!("tree-sitter could not parse the file"))?;
    let root = tree.root_node();
    let src = source.as_bytes();

    let mut file = ParsedFile {
        has_errors: root.has_error(),
        ..ParsedFile::default()
    };
    let mut cursor = root.walk();
    for node in root.named_children(&mut cursor) {
        match node.kind() {
            "import_statement" => file.imports.extend(import(node, src)),
            "export_statement" => export(node, src, &mut file),
            "ambient_declaration" => augmented_members(node, src, &mut file.augments),
            _ => declaration(node, src, false, &mut file),
        }
    }
    dynamic_imports(root, src, &mut file.imports);
    Ok(file)
}

/// The property and method names of the interfaces inside a `declare module` / `declare global`.
fn augmented_members(node: Node, src: &[u8], out: &mut BTreeSet<String>) {
    if matches!(node.kind(), "property_signature" | "method_signature")
        && let Some(name) = node.child_by_field_name("name")
    {
        out.insert(text(name, src).to_string());
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        augmented_members(child, src, out);
    }
}

fn text<'a>(node: Node, src: &'a [u8]) -> &'a str {
    node.utf8_text(src).unwrap_or("")
}

/// `"./x.js"` / `'./x.js'` → `./x.js`
fn string_value(node: Node, src: &[u8]) -> String {
    text(node, src)
        .trim_matches(|c| c == '"' || c == '\'' || c == '`')
        .to_string()
}

fn has_child_kind(node: Node, kind: &str) -> bool {
    let mut cursor = node.walk();
    node.children(&mut cursor).any(|c| c.kind() == kind)
}

fn import(node: Node, src: &[u8]) -> Option<Import> {
    let specifier = string_value(node.child_by_field_name("source")?, src);
    let type_only = has_child_kind(node, "type");
    let mut names = Vec::new();
    let mut cursor = node.walk();
    for clause in node.named_children(&mut cursor) {
        if clause.kind() != "import_clause" {
            continue;
        }
        let mut inner = clause.walk();
        for part in clause.named_children(&mut inner) {
            match part.kind() {
                "identifier" => names.push(text(part, src).to_string()),
                "namespace_import" => {
                    let mut c = part.walk();
                    names.extend(
                        part.named_children(&mut c)
                            .filter(|n| n.kind() == "identifier")
                            .map(|n| text(n, src).to_string()),
                    );
                }
                "named_imports" => {
                    let mut c = part.walk();
                    for spec in part.named_children(&mut c) {
                        let local = spec
                            .child_by_field_name("alias")
                            .or_else(|| spec.child_by_field_name("name"));
                        if let Some(local) = local {
                            names.push(text(local, src).to_string());
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if names.is_empty() {
        names.push("*".into());
    }
    Some(Import {
        specifier,
        names,
        type_only,
        reexport: false,
    })
}

fn export(node: Node, src: &[u8], file: &mut ParsedFile) {
    if let Some(source) = node.child_by_field_name("source") {
        // export { a } from "./x" / export * from "./x"
        let mut names = Vec::new();
        let mut cursor = node.walk();
        for child in node.named_children(&mut cursor) {
            if child.kind() == "export_clause" {
                let mut c = child.walk();
                for spec in child.named_children(&mut c) {
                    if let Some(name) = spec
                        .child_by_field_name("alias")
                        .or_else(|| spec.child_by_field_name("name"))
                    {
                        names.push(text(name, src).to_string());
                    }
                }
            }
        }
        file.exports.extend(names.iter().cloned());
        if names.is_empty() {
            names.push("*".into());
        }
        file.imports.push(Import {
            specifier: string_value(source, src),
            names,
            type_only: has_child_kind(node, "type"),
            reexport: true,
        });
        return;
    }
    if let Some(decl) = node.child_by_field_name("declaration") {
        let before = file.symbols.len();
        declaration(decl, src, true, file);
        // `@Module({ imports: [TasksModule] }) export class AppModule {}`: the decorators belong to
        // the export statement, yet what they name is what the class needs (NestJS, #96).
        let mut decorators = node.walk();
        for decorator in node.children_by_field_name("decorator", &mut decorators) {
            if let Some(class) = file.symbols[before..]
                .iter_mut()
                .find(|s| !s.name.contains('.'))
            {
                let mut members = BTreeSet::new();
                collect_identifiers(decorator, src, &mut class.uses, &mut members);
                let own = class.name.clone();
                class.uses.remove(&own);
            }
        }
        let exported: Vec<_> = file.symbols[before..]
            .iter()
            .filter(|s| !s.name.contains('.'))
            .map(|s| s.name.clone())
            .collect();
        file.exports.extend(exported);
        return;
    }
    let is_default = has_child_kind(node, "default");
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if child.kind() == "export_clause" {
            let mut c = child.walk();
            for spec in child.named_children(&mut c) {
                let local = spec.child_by_field_name("name").map(|n| text(n, src));
                let public = spec
                    .child_by_field_name("alias")
                    .map(|n| text(n, src))
                    .or(local);
                if let Some(public) = public {
                    file.exports.push(public.to_string());
                }
                if let Some(local) = local
                    && let Some(symbol) = file.symbols.iter_mut().find(|s| s.name == local)
                {
                    symbol.exported = true;
                }
            }
        }
    }
    if is_default {
        file.exports.push("default".into());
        if let Some(value) = node.child_by_field_name("value") {
            if value.kind() == "identifier" {
                let name = text(value, src);
                if let Some(symbol) = file.symbols.iter_mut().find(|s| s.name == name) {
                    symbol.exported = true;
                }
            } else {
                file.symbols
                    .push(symbol("default", SymbolKind::Variable, true, value, src));
            }
        }
    }
}

fn symbol(name: &str, kind: SymbolKind, exported: bool, node: Node, src: &[u8]) -> Symbol {
    let mut uses = BTreeSet::new();
    let mut members = BTreeSet::new();
    collect_identifiers(node, src, &mut uses, &mut members);
    uses.remove(name);
    let mut outer_members = BTreeSet::new();
    collect_outer_members(node, src, &mut outer_members);
    Symbol {
        name: name.to_string(),
        kind,
        exported,
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        uses,
        members,
        outer_members,
    }
}

fn collect_outer_members(node: Node, src: &[u8], out: &mut BTreeSet<String>) {
    if node.kind() == "member_expression"
        && let Some(property) = node.child_by_field_name("property")
        && node
            .child_by_field_name("object")
            .is_some_and(|o| o.kind() != "this")
    {
        out.insert(text(property, src).to_string());
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_outer_members(child, src, out);
    }
}

fn collect_identifiers(
    node: Node,
    src: &[u8],
    out: &mut BTreeSet<String>,
    members: &mut BTreeSet<String>,
) {
    match node.kind() {
        "identifier" | "type_identifier" | "shorthand_property_identifier" => {
            out.insert(text(node, src).to_string());
        }
        "member_expression" => {
            if let Some(property) = node.child_by_field_name("property") {
                members.insert(text(property, src).to_string());
            }
        }
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_identifiers(child, src, out, members);
    }
}

fn declaration(node: Node, src: &[u8], exported: bool, file: &mut ParsedFile) {
    let name = |n: Node| {
        n.child_by_field_name("name")
            .map(|n| text(n, src).to_string())
    };
    let kind = match node.kind() {
        "function_declaration" | "generator_function_declaration" => SymbolKind::Function,
        "class_declaration" | "abstract_class_declaration" => SymbolKind::Class,
        "interface_declaration" => SymbolKind::Interface,
        "type_alias_declaration" => SymbolKind::Type,
        "enum_declaration" => SymbolKind::Enum,
        "lexical_declaration" | "variable_declaration" => {
            let mut cursor = node.walk();
            for declarator in node.named_children(&mut cursor) {
                if declarator.kind() != "variable_declarator" {
                    continue;
                }
                let Some(var_name) = name(declarator) else {
                    continue;
                };
                let is_function = declarator.child_by_field_name("value").is_some_and(|v| {
                    matches!(
                        v.kind(),
                        "arrow_function" | "function_expression" | "function"
                    )
                });
                let kind = if is_function {
                    SymbolKind::Function
                } else {
                    SymbolKind::Variable
                };
                // Range of the whole statement, so `export const` lines are included.
                let mut s = symbol(&var_name, kind, exported, declarator, src);
                s.start_line = node.start_position().row + 1;
                file.symbols.push(s);
            }
            return;
        }
        _ => return,
    };
    let Some(sym_name) = name(node) else {
        return;
    };
    let mut s = symbol(&sym_name, kind, exported, node, src);
    if let Some(parent) = node.parent().filter(|p| p.kind() == "export_statement") {
        s.start_line = parent.start_position().row + 1;
    }
    file.symbols.push(s);

    if kind == SymbolKind::Class
        && let Some(body) = node.child_by_field_name("body")
    {
        let mut cursor = body.walk();
        for member in body.named_children(&mut cursor) {
            let member_kind = match member.kind() {
                "method_definition" | "abstract_method_signature" => SymbolKind::Method,
                "public_field_definition" | "field_definition" => SymbolKind::Field,
                _ => continue,
            };
            if let Some(member_name) = member
                .child_by_field_name("name")
                .or_else(|| member.child_by_field_name("property"))
            {
                let full = format!("{sym_name}.{}", text(member_name, src));
                file.symbols
                    .push(symbol(&full, member_kind, exported, member, src));
            }
        }
    }
}

/// `require("x")` and `import("x")` anywhere in the file.
fn dynamic_imports(node: Node, src: &[u8], out: &mut Vec<Import>) {
    if node.kind() == "call_expression"
        && let Some(function) = node.child_by_field_name("function")
        && matches!(function.kind(), "import" | "identifier")
        && (function.kind() == "import" || text(function, src) == "require")
        && let Some(args) = node.child_by_field_name("arguments")
        && let Some(first) = args.named_child(0)
        && first.kind() == "string"
    {
        out.push(Import {
            specifier: string_value(first, src),
            names: vec!["*".into()],
            type_only: false,
            reexport: false,
        });
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        dynamic_imports(child, src, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
import express, { Router, type Request } from "express";
import * as fs from "node:fs";
import type { Note } from "./note.js";
import "./polyfill.js";
export { helper } from "./helper.js";
export * from "./types.js";

const MAX = 10;

export interface Options { limit: number }
export type Id = string;
export enum Color { Red }

export function notesRouter(store: NotesStore): Router {
  const router = Router();
  return router;
}

export class NotesStore {
  private notes = new Map<number, Note>();
  list(): Note[] { return [...this.notes.values()].slice(0, MAX); }
}

const handler = async (req: Request) => fs.readFileSync(req.path);
const lazy = () => import("./lazy.js");
export { handler as defaultHandler };
export default NotesStore;
"#;

    #[test]
    fn imports() {
        let f = parse(Lang::TypeScript, SAMPLE).unwrap();
        let summary: Vec<_> = f
            .imports
            .iter()
            .map(|i| {
                (
                    i.specifier.as_str(),
                    i.names.join(","),
                    i.type_only,
                    i.reexport,
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                ("express", "express,Router,Request".into(), false, false),
                ("node:fs", "fs".into(), false, false),
                ("./note.js", "Note".into(), true, false),
                ("./polyfill.js", "*".into(), false, false),
                ("./helper.js", "helper".into(), false, true),
                ("./types.js", "*".into(), false, true),
                ("./lazy.js", "*".into(), false, false),
            ]
        );
        assert!(!f.has_errors);
    }

    #[test]
    fn symbols_and_exports() {
        let f = parse(Lang::TypeScript, SAMPLE).unwrap();
        let symbols: Vec<_> = f
            .symbols
            .iter()
            .map(|s| (s.name.as_str(), s.kind, s.exported))
            .collect();
        assert_eq!(
            symbols,
            vec![
                ("MAX", SymbolKind::Variable, false),
                ("Options", SymbolKind::Interface, true),
                ("Id", SymbolKind::Type, true),
                ("Color", SymbolKind::Enum, true),
                ("notesRouter", SymbolKind::Function, true),
                ("NotesStore", SymbolKind::Class, true),
                ("NotesStore.notes", SymbolKind::Field, true),
                ("NotesStore.list", SymbolKind::Method, true),
                ("handler", SymbolKind::Function, true),
                ("lazy", SymbolKind::Function, false),
            ]
        );
        for name in [
            "helper",
            "Options",
            "notesRouter",
            "NotesStore",
            "defaultHandler",
            "default",
        ] {
            assert!(
                f.exports.contains(&name.to_string()),
                "missing export {name}"
            );
        }
    }

    #[test]
    fn symbol_ranges_and_uses() {
        let f = parse(Lang::TypeScript, SAMPLE).unwrap();
        let get = |n: &str| f.symbols.iter().find(|s| s.name == n).unwrap();
        let router = get("notesRouter");
        assert_eq!((router.start_line, router.end_line), (15, 18));
        assert!(router.uses.contains("NotesStore") && router.uses.contains("Router"));
        assert!(get("NotesStore.list").uses.contains("MAX"));
        assert!(get("handler").uses.contains("fs"));
    }

    #[test]
    fn decorators_of_an_exported_class_are_what_it_uses() {
        let f = parse(
            Lang::TypeScript,
            "import { Module } from '@nestjs/common';
import { TasksModule } from './tasks.module.js';

@Module({
  imports: [TasksModule],
})
export class AppModule {}
",
        )
        .unwrap();
        let app = f.symbols.iter().find(|s| s.name == "AppModule").unwrap();
        assert!(
            app.uses.contains("TasksModule") && app.uses.contains("Module"),
            "{:?}",
            app.uses
        );
    }

    #[test]
    fn module_augmentations_list_the_members_they_add() {
        let f = parse(
            Lang::TypeScript,
            "import fp from 'fastify-plugin';\ndeclare module 'fastify' {\n  interface FastifyInstance {\n    links: LinksStore;\n    requireAdmin(r: unknown): Promise<void>;\n  }\n}\nexport const storePlugin = fp(async (app) => {});\n",
        )
        .unwrap();
        assert_eq!(
            f.augments,
            BTreeSet::from(["links".to_string(), "requireAdmin".to_string()])
        );
        assert!(f.symbols.iter().any(|s| s.name == "storePlugin"));
    }

    #[test]
    fn commonjs_require() {
        let f = parse(
            Lang::JavaScript,
            "const express = require('express');\nmodule.exports = express();\n",
        )
        .unwrap();
        assert_eq!(f.imports[0].specifier, "express");
    }
}
