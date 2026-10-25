import { describe, expect, it } from "vitest";
import {
  checksPrompt,
  compiledPath,
  describeProblem,
  failureExcerpt,
  generatedAnswer,
  mapTests,
  suiteCommand,
  testKey,
  type CheckOutcome,
  type SuiteRun,
} from "../src/index.ts";

const run = (stepId: string | null, results: Record<string, "pass" | "fail" | "skip">): SuiteRun => ({
  stepId,
  tag: `p/${stepId ?? "s00"}`,
  built: true,
  results: new Map(Object.entries(results)),
});

describe("mapTests", () => {
  it("assigns each test to the first step where it turns green and stays green", () => {
    const runs = [
      run(null, {}),
      run("s01", { a: "pass" }),
      run("s02", { a: "pass", b: "fail" }),
      run("s03", { a: "pass", b: "pass", c: "pass" }),
    ];
    const { byStep, discarded } = mapTests(runs);
    expect(Object.fromEntries(byStep)).toEqual({ s01: ["a"], s03: ["b", "c"] });
    expect(discarded).toEqual([]);
  });

  it("counts a test missing from a run (its file can't load yet) as red", () => {
    const { byStep } = mapTests([run(null, {}), run("s01", {}), run("s02", { a: "pass" })]);
    expect(byStep.get("s02")).toEqual(["a"]);
  });

  it("discards tests that can't prove a step, with the reason", () => {
    const runs = [
      run(null, { setup: "pass" }),
      run("s01", { setup: "pass", flaky: "pass", never: "fail", skipped: "skip" }),
      run("s02", { setup: "pass", flaky: "fail", never: "fail", skipped: "skip" }),
    ];
    expect(mapTests(runs).discarded).toEqual([
      { test: "flaky", reason: "passes at s01 but not at s02" },
      { test: "never", reason: "never passes" },
      { test: "setup", reason: "passes before any step (tests nothing the learner writes)" },
      { test: "skipped", reason: "skipped" },
    ]);
  });

  it("builds stable keys", () => {
    expect(testKey("tests/a.test.ts", "GET /health returns ok")).toBe("tests/a.test.ts › GET /health returns ok");
  });
});

describe("suiteCommand", () => {
  it("asks Vitest and Jest for a JSON report", () => {
    expect(suiteCommand("vitest")).toContain("--reporter=json");
    expect(suiteCommand("jest")).toContain("--json");
    expect(suiteCommand("mocha")).toBeNull();
  });
});

describe("compiledPath", () => {
  it("maps sources to the build output", () => {
    const layout = { outDir: "dist", rootDir: "src" };
    expect(compiledPath("src/notes/notes.store.ts", layout)).toBe("dist/notes/notes.store.js");
    expect(compiledPath("src/a.mts", layout)).toBe("dist/a.mjs");
    expect(compiledPath("lib/x.ts", { outDir: "build", rootDir: "." })).toBe("build/lib/x.js");
    expect(compiledPath("src/a.js", null)).toBe("src/a.js");
  });
});

const outcome = (status: CheckOutcome["status"], stdout = ""): CheckOutcome => ({
  status,
  run: { exitCode: status === "pass" ? 0 : 1, timedOut: false, durationMs: 5, stdout, stderr: "", truncated: false },
});

describe("describeProblem", () => {
  it("rejects a check that fails right after its step, with the output", () => {
    expect(describeProblem("creates a note", outcome("fail", "AssertionError: expected 201"), null)).toMatch(
      /fails on the code right after the step.*\n.*expected 201/s,
    );
  });

  it("rejects a check that already passes before its step", () => {
    expect(describeProblem("creates a note", outcome("pass"), outcome("pass"))).toBe(
      `"creates a note" also passes on the code before the step, so it doesn't test what the step adds`,
    );
  });

  it("accepts red → green", () => {
    expect(describeProblem("creates a note", outcome("pass"), outcome("fail"))).toBeUndefined();
  });
});

describe("checks prompt and answer", () => {
  const step = {
    id: "s10",
    index: 9,
    title: "Build the notes router",
    goal: "GET /notes lists notes",
    concepts: [],
    introduces: [{ unit: "src/notes/notes.routes.ts", kind: "file" as const, change: "add" as const }],
    dependsOn: [],
    checkIds: [],
    estimatedMinutes: 30,
    prep: "planned" as const,
  };

  it("gives the diff, the exact import specifiers and earlier problems", () => {
    const prompt = checksPrompt(
      {
        step,
        diff: "+export function notesRouter() {}",
        importPaths: new Map([["src/notes/notes.routes.ts", "../dist/notes/notes.routes.js"]]),
        dependencies: ["express"],
        exports: new Map([["src/notes/notes.store.ts", ["class NotesStore (methods: list, create)"]]]),
        context: new Map([["src/notes/notes.store.ts", "export class NotesStore {}"]]),
      },
      ['"x" also passes on the code before the step'],
    );
    expect(prompt).toContain("+export function notesRouter() {}");
    expect(prompt).toContain('src/notes/notes.routes.ts → "../dist/notes/notes.routes.js"');
    expect(prompt).toContain("packages if useful: express");
    expect(prompt).toContain("- src/notes/notes.store.ts: class NotesStore (methods: list, create)");
    expect(prompt).toContain("Source of src/notes/notes.store.ts, which the new code uses");
    expect(prompt).toContain('- "x" also passes on the code before the step');
    // The alpha run's fragile checks (#66): internal fields, fixed ports, exact output.
    expect(prompt).toContain("Never read or set\n  an object's internal fields");
    expect(prompt).toContain("never use a fixed port");
    expect(prompt).toContain("don't depend on the exact\n  text the program prints");
  });

  it("allows no check, with a reason, for steps that add nothing observable", () => {
    expect(generatedAnswer.safeParse({ checks: [], reasonIfNone: "types only" }).success).toBe(true);
    expect(generatedAnswer.safeParse({ checks: Array(4).fill({ label: "a check", code: "x".repeat(30) }) }).success).toBe(false);
  });
});

describe("failureExcerpt", () => {
  it("puts the real error first, even when Node prints a long summary after it", () => {
    const stdout = [
      "TAP version 13",
      "# SyntaxError: The requested module '../dist/links/links.store.js' does not provide an export named 'InMemoryLinksStore'",
      "#     at ModuleJob._instantiate (node:internal/modules/esm/module_job:226:21)",
      ...Array.from({ length: 40 }, (_, i) => `  line ${i} of the summary`),
      "# fail 1",
    ].join("\n");
    const excerpt = failureExcerpt(outcome("fail", stdout));
    expect(excerpt.split("\n")[0]).toContain("does not provide an export named 'InMemoryLinksStore'");
    expect(excerpt).not.toContain("ModuleJob._instantiate");
    expect(excerpt).toContain("fail 1");
  });
});
