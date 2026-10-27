// The pieces of code a step can introduce, and what each one needs (design/02 ⑥, design/03
// unit ids). Built from the code graph only: deterministic, no AI.

import type { Graph } from "../sys/knyc-sys.ts";

export type AtomKind = "file" | "function" | "class" | "method" | "interface" | "type" | "enum" | "variable";

/**
 * The smallest unit a step can introduce:
 * - a top-level symbol: "src/a.ts#createApp"
 * - a class method: "src/a.ts#Store.list" (the class atom keeps its fields and constructor)
 * - a whole file, when it has only variables and top-level code: "src/server.ts"
 */
export interface Atom {
  id: string;
  file: string;
  kind: AtomKind;
  /** Class atom id, for methods. */
  parent?: string;
  /** Exported from its file (a method follows its class). Whole-file atoms count as exported. */
  exported: boolean;
  lines: number;
  /** 1-based, inclusive line range in the original file (the whole file for file atoms). */
  startLine: number;
  endLine: number;
}

export interface Units {
  /** In layer order (leaves first), then source order. */
  atoms: Atom[];
  byId: Map<string, Atom>;
  /** File path → its atom ids, for "introduce the whole file". */
  byFile: Map<string, string[]>;
  /** Atom id → atom ids it needs (never itself). */
  needs: Map<string, Set<string>>;
}

const ATOM_KINDS = new Set(["function", "class", "interface", "type", "enum", "variable"]);

export function buildUnits(graph: Graph): Units {
  const atoms: Atom[] = [];
  const byId = new Map<string, Atom>();
  const byFile = new Map<string, string[]>();
  const files = new Map(graph.files.map((f) => [f.path, f]));

  for (const path of graph.layers.flat()) {
    const file = files.get(path);
    if (!file || file.test) continue;
    const fileAtoms: Atom[] = [];
    const exportedSymbols = new Set(file.symbols.filter((s) => s.exported).map((s) => s.name));
    for (const symbol of file.symbols) {
      const lines = symbol.endLine - symbol.startLine + 1;
      const range = { startLine: symbol.startLine, endLine: symbol.endLine };
      if (!symbol.name.includes(".") && ATOM_KINDS.has(symbol.kind)) {
        fileAtoms.push({ id: `${path}#${symbol.name}`, file: path, kind: symbol.kind as AtomKind, exported: symbol.exported, lines, ...range });
      } else if (symbol.kind === "method" && !symbol.name.endsWith(".constructor")) {
        const owner = symbol.name.split(".")[0]!;
        fileAtoms.push({ id: `${path}#${symbol.name}`, file: path, kind: "method", parent: `${path}#${owner}`, exported: exportedSymbols.has(owner), lines, ...range });
      }
      // Fields and constructors belong to their class atom.
    }
    // A file of only variables and top-level statements (an entry point like server.ts) is one
    // unit: its statements aren't symbols, so splitting it would lose what they need.
    if (fileAtoms.every((a) => a.kind === "variable")) {
      fileAtoms.length = 0;
      fileAtoms.push({ id: path, file: path, kind: "file", exported: true, lines: file.loc, startLine: 1, endLine: file.loc });
    }
    for (const atom of fileAtoms) {
      atoms.push(atom);
      byId.set(atom.id, atom);
    }
    byFile.set(path, fileAtoms.map((a) => a.id));
  }

  /** A symbol id from the graph → the atom that holds it. */
  const atomOf = (symbolId: string): string | undefined => {
    if (byId.has(symbolId)) return symbolId;
    const [path, name] = symbolId.split("#");
    if (!name) return byFile.get(symbolId)?.[0];
    const owner = `${path}#${name.split(".")[0]}`; // field or constructor → its class
    if (byId.has(owner)) return owner;
    // A variable of a whole-file unit (a plugin file: `export const storePlugin = fp(…)`).
    const whole = byFile.get(path!);
    return whole?.length === 1 && byId.get(whole[0]!)?.kind === "file" ? whole[0] : undefined;
  };

  const needs = new Map<string, Set<string>>(atoms.map((a) => [a.id, new Set<string>()]));
  const add = (from: string | undefined, to: string | undefined) => {
    if (from && to && from !== to) needs.get(from)?.add(to);
  };
  for (const [from, to] of graph.symbolEdges) add(atomOf(from), atomOf(to));
  for (const atom of atoms) if (atom.parent) add(atom.id, atom.parent);

  // Whole-file atoms need what the file imports.
  for (const atom of atoms.filter((a) => a.kind === "file")) {
    for (const imp of files.get(atom.file)?.imports ?? []) {
      if (!imp.resolved) continue;
      const targets = byFile.get(imp.resolved) ?? [];
      const named = imp.names.map((n) => `${imp.resolved}#${n}`).filter((id) => byId.has(id));
      for (const target of named.length > 0 ? named : targets) add(atom.id, target);
    }
  }

  return { atoms, byId, byFile, needs };
}

const BEHAVIOR_KINDS = new Set<AtomKind>(["function", "class", "method", "variable"]);

/**
 * Code a check can run: an exported function, class, method or value, or a whole file of top-level
 * code (an entry point). Types, interfaces, enums and private helpers alone give a step nothing to
 * check (design/08, improvement 1).
 */
export function hasBehavior(atom: Atom): boolean {
  return atom.kind === "file" || (atom.exported && BEHAVIOR_KINDS.has(atom.kind));
}

/** Unit list for prompts: one line per atom, grouped by file, with what it needs. */
export function describeUnits(units: Units, purposes: Map<string, string> = new Map()): string {
  const lines: string[] = [];
  for (const [file, ids] of units.byFile) {
    lines.push(`${file}`);
    for (const id of ids) {
      const atom = units.byId.get(id)!;
      const needs = [...units.needs.get(id)!].map((n) => n.replace(/^.*#/, "")).sort();
      const purpose = purposes.get(id);
      lines.push(
        `  - ${id} (${atom.kind}, ${atom.lines} lines${atom.exported ? "" : ", private"})${purpose ? ` — ${purpose}` : ""}${needs.length ? ` · needs: ${needs.join(", ")}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}
