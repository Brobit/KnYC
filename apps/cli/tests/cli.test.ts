import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AiError, buildUnits, emptyUsage, graphSchema, learningPath, loadDocument, type Check, type Scan, type StepChecks } from "@knyc/core";
import { renderEvaluation } from "../src/eval.ts";
import { explain, parse, UsageError } from "../src/main.ts";
import { renderReport } from "../src/report.ts";
import { initialProgress, projectDocument, writeWorkspace } from "../src/workspace.ts";

const coreFixture = (kind: string, name: string) =>
  JSON.parse(readFileSync(new URL(`../../../packages/core/tests/fixtures/${kind}/${name}.json`, import.meta.url), "utf8"));

describe("parse", () => {
  it("reads the analyze command with defaults", () => {
    expect(parse(["analyze", "../app"])).toEqual({
      command: "analyze",
      folder: "../app",
      track: "backend",
      size: "standard",
      workspace: undefined,
      models: { summaries: "haiku", planning: "sonnet", checks: "sonnet" },
      yes: false,
    });
    expect(parse(["analyze", "app", "--size", "deep", "--planning", "opus", "-y"])).toMatchObject({ size: "deep", models: { planning: "opus" }, yes: true });
  });

  it("shows help, and refuses wrong input with a clear message", () => {
    expect(parse([]).command).toBe("help");
    expect(parse(["--help"]).command).toBe("help");
    expect(() => parse(["analyse", "app"])).toThrow('unknown command "analyse"');
    expect(() => parse(["analyze"])).toThrow("missing the project folder");
    expect(() => parse(["analyze", "app", "--track", "mobile"])).toThrow("--track must be one of");
    expect(() => parse(["analyze", "app", "extra"])).toThrow('unexpected argument "extra"');
  });
});

describe("explain", () => {
  it("tells the learner what to do", () => {
    expect(explain(new AiError("auth", "not logged in"))).toContain("/login");
    expect(explain(new AiError("limit", "session limit"))).toContain("finished stages come from the cache");
    expect(explain(new UsageError("bad"))).toContain("Usage:");
  });
});

const graph = graphSchema.parse(coreFixture("graphs", "express-no-tests"));
const units = buildUnits(graph);
const path = learningPath.parse(coreFixture("plans", "express-no-tests.standard"));
const checksRun = coreFixture("checks", "express-no-tests.standard.checks") as { report: StepChecks[]; checks: Check[]; files: Record<string, string> };
const scan: Scan = {
  root: "/code/express-no-tests",
  hash: "blake3:abc",
  languages: [{ id: "typescript", files: 9, loc: 254 }],
  frameworks: [{ profileId: "express", version: "5.3.0", root: "." }],
  testRunners: [],
  packages: [],
  commands: [{ root: ".", install: "npm ci", build: "npm run build", test: null, run: "npm run start" }],
  toolchains: [{ id: "node", required: "any", found: "22.23.2" }],
  files: [{ path: "assets/logo.png", bytes: 10, lines: 0, notForAi: "binary" }, { path: "package-lock.json", bytes: 10, lines: 1, notForAi: "lockfile" }],
  excluded: [{ path: ".env", reason: "secret" }, { path: "node_modules/", reason: "ignored" }],
  secretLines: [],
};
const now = new Date("2026-10-21T12:00:00.000Z");

describe("workspace documents", () => {
  it("builds a valid project.json from the scan", () => {
    const project = projectDocument("/code/express-no-tests", scan, units, "backend", now);
    expect(project.tracks[0]).toMatchObject({ id: "backend", label: "Backend" });
    expect(project.tracks[0]!.units).toHaveLength(units.atoms.length);
    expect(project.excluded).toEqual([
      { path: ".env", reason: "secret" },
      { path: "node_modules/", reason: "ignored" },
      { path: "assets/logo.png", reason: "binary" },
    ]);
    expect(project.commands[0]).not.toHaveProperty("test");
  });

  it("starts progress on the first step, the others locked", () => {
    const progress = initialProgress(path, now);
    const steps = progress.paths[path.id]!.steps;
    expect(steps.s01!.status).toBe("available");
    expect(Object.values(steps).filter((s) => s.status === "locked")).toHaveLength(path.steps.length - 1);
  });

  it("writes every document under .knyc/, readable again by loadDocument", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knyc-ws-"));
    try {
      const written = await writeWorkspace(dir, {
        project: projectDocument("/code/express-no-tests", scan, units, "backend", now),
        path,
        checks: checksRun.checks,
        checkFiles: new Map(Object.entries(checksRun.files)),
        progress: initialProgress(path, now),
        report: "# report\n",
      });
      expect(written).toContain(join(".knyc", "project.json"));
      const paths = await readdir(join(dir, ".knyc", "paths"));
      expect(paths).toEqual([`${path.id}.json`]);
      const stored = loadDocument("path", JSON.parse(await readFile(join(dir, ".knyc", "paths", paths[0]!), "utf8")));
      expect(stored.steps).toHaveLength(path.steps.length);
      const checkFiles = await readdir(join(dir, ".knyc", "checks", path.id, "files", ".knyc-checks"));
      expect(checkFiles.length).toBe(Object.keys(checksRun.files).length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("renderReport", () => {
  it("shows the proven share, each step with its checks, and the stage costs", () => {
    const markdown = renderReport({
      projectName: "express-no-tests",
      path,
      timeline: { pathId: path.id, workDir: "/tmp/x", finalMatchesOriginal: true, steps: path.steps.map((s) => ({ stepId: s.id, ok: s.id !== "s01", durationMs: 1, ...(s.id === "s01" ? { mergedInto: "s02" } : { tag: `${path.id}/${s.id}` }) })) },
      checks: checksRun.checks,
      stepChecks: checksRun.report,
      stages: [
        { name: "Summaries", seconds: 100, calls: 4 },
        { name: "Checks", seconds: 300, calls: 15 },
      ],
      usage: emptyUsage(),
      costUsd: 0,
      models: { summaries: "haiku", planning: "sonnet", checks: "sonnet" },
    });
    expect(markdown).toContain("**13/15 steps (87%) with a check proven red → green**");
    expect(markdown).toContain("14/15 steps build on their own");
    expect(markdown).toContain("🔗 **s01**");
    expect(markdown).toContain("| **Total** | **400 s** | **19** |");
  });
});

describe("eval", () => {
  it("parses several projects and requires --out", () => {
    expect(parse(["eval", "a", "b", "--out", "res"])).toMatchObject({ command: "eval", folders: ["a", "b"], out: "res" });
    expect(() => parse(["eval", "a"])).toThrow("knyc eval needs --out <folder>");
  });

  it("totals the projects and decides against the threshold, keeping failed ones visible", () => {
    const base = { size: "standard" as const, units: 10, milestones: 3, weak: 1, merged: 1, timelineBuilds: 9, finalMatchesOriginal: true, aiCalls: 10, checkRetries: 1, stages: [], seconds: 600, checks: { repo: 2, generated: 10, trivial: 1 } };
    const markdown = renderEvaluation([
      { ...base, project: "a", steps: 10, proven: 8, trivialOnly: 0 },
      { ...base, project: "b", steps: 10, proven: 9, trivialOnly: 0 },
      { project: "c", size: "standard", error: "Claude Code usage limit reached" },
    ]);
    expect(markdown).toContain("| **Total** | **20** | **17 (85%)**");
    expect(markdown).toContain("**error:** Claude Code usage limit reached");
    expect(markdown).toContain("**GO**: 85% of steps");
    expect(renderEvaluation([{ ...base, project: "a", steps: 10, proven: 7, trivialOnly: 1 }])).toContain("**NO-GO**");
  });
});
