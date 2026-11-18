// Builds a file as it is at step k of the reference timeline (design/02 ⑦): the original file,
// minus the units not introduced yet, minus imports and exports that point at code that
// doesn't exist yet. Deterministic: line ranges come from the code graph.

import type { GraphFile } from "../sys/knyc-sys.ts";
import type { Atom } from "./units.ts";

export interface SliceContext {
  /** Does this file exist at step k? */
  fileExists(path: string): boolean;
  /**
   * Does top-level symbol `name` of `path` exist at step k? `undefined` when the name isn't a
   * known unit (then the import is kept, to be safe).
   */
  symbolExists(path: string, name: string): boolean | undefined;
}

const COMMENT_OR_DECORATOR = /^\s*(\/\/|\/\*|\*|@)/;
/** Python (#126): a symbol's range already holds its decorators. */
const PYTHON_COMMENT = /^\s*#/;

/** Line ranges (0-based, inclusive) to remove: units not kept, with the comments just above them. */
function removedLines(lines: string[], atoms: Atom[], keep: Set<string>, comment = COMMENT_OR_DECORATOR): Set<number> {
  const removed = new Set<number>();
  for (const atom of atoms) {
    if (keep.has(atom.id)) continue;
    // A method inside a removed class is already gone with the class.
    if (atom.parent && !keep.has(atom.parent)) continue;
    let start = atom.startLine - 1;
    while (start > 0 && comment.test(lines[start - 1]!) && !removed.has(start - 1)) start -= 1;
    for (let i = start; i <= atom.endLine - 1; i++) removed.add(i);
  }
  return removed;
}

const IMPORT = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+(["'])([^"']+)\3;?[ \t]*$/gm;
const SIDE_EFFECT_IMPORT = /^import\s+(["'])([^"']+)\1;?[ \t]*$/gm;
const EXPORT_FROM = /^export\s+(type\s+)?(\*|\{[\s\S]*?\})(\s+as\s+\w+)?\s+from\s+(["'])([^"']+)\4;?[ \t]*$/gm;
const EXPORT_LIST = /^export\s+(type\s+)?\{([\s\S]*?)\};?[ \t]*$/gm;
const EXPORT_DEFAULT_NAME = /^export\s+default\s+([A-Za-z_$][\w$]*);?[ \t]*$/gm;

/** "{ a, b as c, type D }" → [{ text: "b as c", imported: "b", local: "c" }, …] */
function specifiers(braces: string) {
  return braces
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => {
      const [imported, local] = text.replace(/^type\s+/, "").split(/\s+as\s+/);
      return { text, imported: imported!.trim(), local: (local ?? imported!).trim() };
    });
}

function pruneImports(source: string, file: GraphFile, ctx: SliceContext): string {
  const resolvedOf = (specifier: string) => file.imports.find((i) => i.specifier === specifier)?.resolved;
  const exists = (path: string, name: string) => ctx.symbolExists(path, name) !== false;

  let out = source.replace(IMPORT, (statement, typeKw: string | undefined, clause: string, _q, specifier: string) => {
    const target = resolvedOf(specifier);
    if (!target) return statement; // a package, or unresolved: leave it
    if (!ctx.fileExists(target)) return "";
    const braces = clause.match(/\{[\s\S]*\}/)?.[0];
    if (!braces) return statement; // default or namespace import of an existing file
    const kept = specifiers(braces).filter((s) => exists(target, s.imported));
    const head = clause.slice(0, clause.indexOf("{")).replace(/,\s*$/, "").trim(); // default import, if any
    if (kept.length === 0 && !head) return "";
    const named = kept.length > 0 ? `{ ${kept.map((s) => s.text).join(", ")} }` : "";
    return `import ${typeKw ?? ""}${[head, named].filter(Boolean).join(", ")} from "${specifier}";`;
  });
  out = out.replace(SIDE_EFFECT_IMPORT, (statement, _q, specifier: string) => {
    const target = resolvedOf(specifier);
    return target && !ctx.fileExists(target) ? "" : statement;
  });
  out = out.replace(EXPORT_FROM, (statement, typeKw: string | undefined, what: string, alias: string | undefined, _q, specifier: string) => {
    const target = resolvedOf(specifier);
    if (!target) return statement;
    if (!ctx.fileExists(target)) return "";
    if (what === "*") return statement;
    const kept = specifiers(what).filter((s) => exists(target, s.imported));
    if (kept.length === 0) return "";
    return `export ${typeKw ?? ""}{ ${kept.map((s) => s.text).join(", ")} }${alias ?? ""} from "${specifier}";`;
  });
  return out;
}

function pruneExports(source: string, file: GraphFile, ctx: SliceContext): string {
  const local = (name: string) => ctx.symbolExists(file.path, name) !== false;
  return source
    .replace(EXPORT_LIST, (statement, typeKw: string | undefined, list: string) => {
      const kept = specifiers(`{${list}}`).filter((s) => local(s.imported));
      if (kept.length === specifiers(`{${list}}`).length) return statement;
      return kept.length === 0 ? "" : `export ${typeKw ?? ""}{ ${kept.map((s) => s.text).join(", ")} };`;
    })
    .replace(EXPORT_DEFAULT_NAME, (statement, name: string) => (local(name) ? statement : ""));
}

/** `from .models import Note, NoteIn` (one line, or in parentheses over several). */
const PYTHON_FROM = /^from[ \t]+(\S+)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*?)[ \t]*$/gm;
/** `import app.db`, `import app.db as database` (one module per statement). */
const PYTHON_IMPORT = /^import[ \t]+([\w.]+)([ \t]+as[ \t]+\w+)?[ \t]*$/gm;

/**
 * Python (#126): imports of modules that don't exist yet go, and so do names not written yet.
 * `from pkg import mod` imports a module when the graph says so (its specifier is "pkg.mod").
 */
function prunePythonImports(source: string, file: GraphFile, ctx: SliceContext): string {
  const importOf = (specifier: string) => file.imports.find((i) => i.specifier === specifier);
  const gone = (specifier: string) => {
    const target = importOf(specifier)?.resolved;
    return target !== undefined && !ctx.fileExists(target);
  };
  return source
    .replace(PYTHON_IMPORT, (statement, module: string) => (gone(module) ? DROPPED : statement))
    .replace(PYTHON_FROM, (statement, module: string, list: string) => {
      const names = list
        .replace(/^\(|\)$/g, "")
        .split(/,|\n/)
        .map((n) => n.replace(/#.*$/, "").trim())
        .filter(Boolean);
      if (names.includes("*")) return gone(module) ? DROPPED : statement;
      const kept = names.filter((text) => {
        const name = text.split(/\s+as\s+/)[0]!;
        const sub = importOf(module.endsWith(".") ? `${module}${name}` : `${module}.${name}`);
        if (sub?.module && sub.resolved) return ctx.fileExists(sub.resolved);
        const target = importOf(module)?.resolved;
        if (!target) return true; // a library, or unresolved: leave it
        return ctx.fileExists(target) && ctx.symbolExists(target, name) !== false;
      });
      if (kept.length === names.length) return statement;
      return kept.length === 0 ? DROPPED : `from ${module} import ${kept.join(", ")}`;
    })
    .replace(new RegExp(`^${DROPPED}\n?`, "gm"), "");
}

/** An import line that goes, with its line break. */
const DROPPED = "\u0000knyc-dropped\u0000";

/** Python (#126): a class whose methods aren't written yet still needs a body. */
function fillEmptyClasses(source: string): string {
  const lines = source.split("\n");
  const indent = (line: string) => line.length - line.trimStart().length;
  const out: string[] = [];
  lines.forEach((line, i) => {
    out.push(line);
    const header = /^(\s*)class\b.*:\s*(#.*)?$/.exec(line);
    if (!header) return;
    const next = lines.slice(i + 1).find((l) => l.trim() !== "");
    if (next === undefined || indent(next) <= header[1]!.length) out.push(`${header[1]}    pass`);
  });
  return out.join("\n");
}

/**
 * The file at step k. `atoms` are this file's units; `keep` holds the unit ids introduced so far.
 * Returns null when nothing of the file exists yet.
 */
const PRISMA_FIELD = /^\s*\w+\s+(\w+)(\[\]|\?)?(\s|$)/;

/**
 * Prisma (#98): a kept model's fields typed with a model that isn't there yet. Only the other side
 * of a relation can be (`books Book[]`): the side holding the foreign key needs its model.
 */
function pruneRelations(source: string, absent: Set<string>): string {
  return source
    .split("\n")
    .filter((line) => !absent.has(line.match(PRISMA_FIELD)?.[1] ?? ""))
    .join("\n");
}

export function sliceSource(content: string, file: GraphFile, atoms: Atom[], keep: Set<string>, ctx: SliceContext): string | null {
  // A Prisma schema without models still has its generator and datasource (#98): the client is
  // generated from the first step.
  const prisma = file.language === "prisma";
  if (!prisma && !atoms.some((a) => keep.has(a.id))) return null;
  if (atoms.every((a) => keep.has(a.id))) return content; // complete: the original, untouched

  const lines = content.split("\n");
  const python = file.language === "python";
  const removed = removedLines(lines, atoms, keep, python ? PYTHON_COMMENT : COMMENT_OR_DECORATOR);
  let source = lines.filter((_, i) => !removed.has(i)).join("\n");
  source = python
    ? fillEmptyClasses(prunePythonImports(source, file, ctx))
    : prisma
    ? pruneRelations(source, new Set(atoms.filter((a) => !keep.has(a.id)).map((a) => a.id.slice(a.id.indexOf("#") + 1))))
    : pruneExports(pruneImports(source, file, ctx), file, ctx);
  // Removing blocks leaves runs of blank lines behind, and blank lines before a closing brace.
  // Python keeps two between top-level definitions (PEP 8).
  return source
    .replace(python ? /\n([ \t]*\n){3,}/g : /\n[ \t]*\n([ \t]*\n)+/g, python ? "\n\n\n" : "\n\n")
    .replace(/\n[ \t]*\n([ \t]*\})/g, "\n$1")
    .replace(/^\s*\n/, "")
    .replace(/\s*$/, content.endsWith("\n") ? "\n" : "");
}
