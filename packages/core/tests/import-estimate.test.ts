import { describe, expect, it } from "vitest";
import graphFixture from "./fixtures/graphs/express-notes.json";
import { buildUnits, estimateAnalysis, graphSchema, importReport, stepRange, type Scan } from "../src/index.ts";

const graph = graphSchema.parse(graphFixture);

const scan = (): Scan => ({
  root: "/src/notes",
  hash: "blake3:abc",
  languages: [{ id: "typescript", files: 11, loc: 400 }],
  frameworks: [{ profileId: "express", version: "^4.21.2", root: "." }],
  testRunners: [
    { runner: "vitest", root: "." },
    { runner: "vitest", root: "api" },
  ],
  packages: [],
  commands: [],
  toolchains: [],
  files: [
    ...graph.files.map((f) => ({ path: f.path, bytes: 4_000, lines: 100 })),
    { path: "package-lock.json", bytes: 90_000, lines: 2_400, notForAi: "lockfile" },
    { path: "docs/logo.png", bytes: 40_000, lines: 0, notForAi: "binary" },
  ],
  excluded: [
    { path: "node_modules/", reason: "ignored" },
    { path: ".env", reason: "secret" },
  ],
  secretLines: [],
});

describe("estimateAnalysis", () => {
  it("counts batches, the plan and one call per step, as the CLI did", () => {
    // 10 files of 2,000 tokens: 8 per batch at most → 2 batches, + folders + project.
    const estimate = estimateAnalysis(Array(10).fill(2_000), 30, "standard");
    const range = stepRange("standard", 30);
    const steps = Math.round((range.min + range.max) / 2);
    expect(estimate.steps).toBe(steps);
    expect(estimate.summaryCalls).toBe(4);
    expect(estimate.calls).toBe(4 + 1 + steps);
    expect(estimate.tokens).toBe(20_000 + estimate.calls * 6_000 + steps * 4_000);
    expect(estimate.minutes).toBe(Math.round((estimate.calls * 45) / 60));
  });

  it("puts a file over the budget in its own batch and never says 0 minutes", () => {
    expect(estimateAnalysis([20_000, 100, 100], 2, "overview").summaryCalls).toBe(2 + 2);
    expect(estimateAnalysis([10], 1, "overview").minutes).toBeGreaterThanOrEqual(1);
  });
});

describe("importReport", () => {
  it("shows what the summaries will read and what is excluded, and why", () => {
    const report = importReport(scan(), graph);
    const sources = graph.files.filter((f) => !f.test);
    expect(report.filesSent).toBe(sources.length);
    expect(report.files).toBe(graph.files.length + 2);
    expect(report.filesExcluded).toBe(4);
    expect(report.excluded).toEqual([
      { reason: "secret", paths: [".env"] },
      { reason: "ignored", paths: ["node_modules/"] },
      { reason: "binary", paths: ["docs/logo.png"] },
      { reason: "lockfile", paths: ["package-lock.json"] },
    ]);
    // Lockfiles and binaries don't count as lines of code.
    expect(report.lines).toBe(graph.files.length * 100);
    expect(report.languages).toEqual(["TypeScript"]);
    expect(report.frameworks).toEqual(["Express 4.21.2"]);
    expect(report.testRunners).toEqual(["Vitest"]);
    expect(report.estimate).toEqual(estimateAnalysis(Array(sources.length).fill(1_000), buildUnits(graph).atoms.length, "standard"));
  });
});
