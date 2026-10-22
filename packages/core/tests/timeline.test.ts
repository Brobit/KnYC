import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  buildUnits,
  filesAtStep,
  findKnycSys,
  graphSchema,
  learningPath,
  scanProject,
  sliceSource,
  stepOfUnits,
  type GraphFile,
} from "../src/index.ts";

const fixture = (kind: string, name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${kind}/${name}.json`, import.meta.url), "utf8"));
const goldenRoot = (name: string) => fileURLToPath(new URL(`../../../fixtures/golden/${name}`, import.meta.url));
const load = (name: string, plan: string) => {
  const graph = graphSchema.parse(fixture("graphs", name));
  const path = learningPath.parse(fixture("plans", `${name}.${plan}`));
  const units = buildUnits(graph);
  return { graph, path, units, stepOf: stepOfUnits(path, units), read: (p: string) => readFile(join(goldenRoot(name), p), "utf8") };
};

describe("sliceSource", () => {
  const file: GraphFile = {
    path: "src/b.ts",
    language: "typescript",
    loc: 0,
    test: false,
    parseErrors: false,
    imports: [
      { specifier: "./a.js", resolved: "src/a.ts", names: ["one", "two"], typeOnly: false, reexport: false },
      { specifier: "./c.js", resolved: "src/c.ts", names: ["C"], typeOnly: true, reexport: false },
      { specifier: "express", package: "express", names: ["express"], typeOnly: false, reexport: false },
    ],
    exports: [],
    symbols: [],
  };
  const source = `import express from "express";
import { one, two as deux } from "./a.js";
import type { C } from "./c.js";

/** Doubles. */
export function double(x: number) {
  return x * 2;
}

// Uses two.
export function useTwo() {
  return deux();
}
`;
  const atoms = [
    { id: "src/b.ts#double", file: "src/b.ts", kind: "function" as const, exported: true, lines: 3, startLine: 6, endLine: 8 },
    { id: "src/b.ts#useTwo", file: "src/b.ts", kind: "function" as const, exported: true, lines: 3, startLine: 11, endLine: 13 },
  ];
  const ctx = {
    fileExists: (p: string) => p !== "src/c.ts",
    symbolExists: (p: string, n: string) => (p === "src/a.ts" ? n === "one" : undefined),
  };

  it("removes later units with their comments, and imports of code that doesn't exist yet", () => {
    expect(sliceSource(source, file, atoms, new Set(["src/b.ts#double"]), ctx)).toBe(`import express from "express";
import { one } from "./a.js";

/** Doubles. */
export function double(x: number) {
  return x * 2;
}
`);
  });

  it("returns null before the file's first unit and the original once complete", () => {
    expect(sliceSource(source, file, atoms, new Set(), ctx)).toBeNull();
    expect(sliceSource(source, file, atoms, new Set(atoms.map((a) => a.id)), ctx)).toBe(source);
  });
});

describe("filesAtStep on the real express-notes plan", () => {
  it("grows NotesStore across two steps, with no gaps or leftovers", async () => {
    const { graph, path, units, stepOf, read } = load("express-notes", "standard");
    const at = async (id: string) => filesAtStep(path.steps.findIndex((s) => s.id === id), graph, units, stepOf, read);

    const s05 = await at("s05");
    const store = s05.get("src/notes/notes.store.ts")!;
    expect(store).toContain("create(input: NoteInput)");
    expect(store).not.toContain("update(");
    expect(store).not.toContain("remove(");
    expect(store).not.toMatch(/\n\s*\n\}/); // no blank line before the class's closing brace
    expect(s05.get("src/notes/notes.routes.ts")).toBeNull();

    const s06 = await at("s06");
    expect(s06.get("src/notes/notes.store.ts")).toBe(await read("src/notes/notes.store.ts"));
  });

  it("ends with every source file exactly as in the original", async () => {
    const { graph, path, units, stepOf, read } = load("express-shop", "standard");
    const last = await filesAtStep(path.steps.length - 1, graph, units, stepOf, read);
    for (const [p, content] of last) expect(content, p).toBe(await read(p));
  });

  it("starts with no source files at all", async () => {
    const { graph, units, stepOf, read } = load("express-notes", "overview");
    const before = await filesAtStep(-1, graph, units, stepOf, read);
    expect([...before.values()].every((c) => c === null)).toBe(true);
  });
});

const knycSys = findKnycSys();
// Full builds install dependencies and run tsc once per step: opt in with KNYC_SLOW_TESTS=1.
describe.skipIf(!knycSys || !process.env.KNYC_SLOW_TESTS)("buildTimeline (slow, real builds)", () => {
  it("builds every step of express-notes overview on its own", { timeout: 15 * 60_000 }, async () => {
    const { graph, path, units } = load("express-notes", "overview");
    const workDir = join(await mkdtemp(join(tmpdir(), "knyc-timeline-")), "repo");
    try {
      const scan = await scanProject(goldenRoot("express-notes"));
      const timeline = await buildTimeline(path, graph, scan, units, { sourceRoot: goldenRoot("express-notes"), workDir });
      // s01 is config.ts alone, which reads `process`. Since TypeScript 6, Node's types only came
      // through Express's types, so s01 failed and merged into s02 (design/08). The setup now
      // names them in tsconfig.json.
      expect(timeline.setupFixes).toEqual(['tsconfig.json: added "types": ["node"]']);
      expect(timeline.steps.every((s) => s.ok && s.tag === `${path.id}/${s.stepId}`)).toBe(true);
      expect(timeline.finalMatchesOriginal).toBe(true);
    } finally {
      await rm(join(workDir, ".."), { recursive: true, force: true });
    }
  });
});
