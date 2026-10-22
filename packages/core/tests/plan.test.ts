import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AiClient,
  behaviorCount,
  buildUnits,
  generatePlan,
  graphSchema,
  hasBehavior,
  learningPath,
  placeUnits,
  planPrompt,
  planSchema,
  profiles,
  stepRange,
  stepsWithoutBehavior,
  toLearningPath,
  type AiProvider,
  type PlanAnswer,
  type ProviderRequest,
  type ProviderResponse,
  type Summaries,
} from "../src/index.ts";

const fixture = (kind: string, name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${kind}/${name}.json`, import.meta.url), "utf8"));
const graph = (name: string) => graphSchema.parse(fixture("graphs", name));
const summaries = (name: string) => fixture("summaries", name) as Summaries;

const notesUnits = buildUnits(graph("express-notes"));
const shopUnits = buildUnits(graph("express-shop"));

const step = (introduces: string[], title = `Step for ${introduces[0]}`) => ({
  title,
  goal: "Something observable works after this step.",
  concepts: ["a concept"],
  introduces,
  checkStrategy: "existing-tests" as const,
  estimatedMinutes: 20,
});

/** A correct overview plan for express-notes (5 steps, whole files). */
const notesPlan = (): PlanAnswer => ({
  milestones: [
    { title: "Foundations", summary: "Config and errors the rest relies on.", steps: [step(["src/config.ts", "src/errors.ts"])] },
    {
      title: "Notes",
      summary: "Store, validate and expose notes.",
      steps: [
        step(["src/notes/note.ts", "src/notes/notes.store.ts"]),
        step(["src/notes/notes.validation.ts"]),
        step(["src/notes/notes.routes.ts"]),
      ],
    },
    { title: "Serve it", summary: "Wire the app and start the server.", steps: [step(["src/app.ts", "src/server.ts"])] },
  ],
});

describe("units from the real graphs", () => {
  it("has symbols, methods and whole-file entry points", () => {
    expect(notesUnits.atoms).toHaveLength(21);
    expect(notesUnits.byId.get("src/server.ts")?.kind).toBe("file");
    expect(notesUnits.byId.get("src/notes/notes.store.ts#NotesStore.update")?.parent).toBe("src/notes/notes.store.ts#NotesStore");
    expect(notesUnits.needs.get("src/server.ts")).toEqual(new Set(["src/app.ts#createApp", "src/config.ts#loadConfig"]));
  });

  it("knows that checkout needs reserveStock through an injected service", () => {
    expect(shopUnits.needs.get("src/orders/orders.service.ts#OrdersService.checkout")).toContain(
      "src/products/products.service.ts#ProductsService.reserveStock",
    );
  });
});

describe("stepRange", () => {
  it("follows the sizes, capped by the number of units", () => {
    expect(stepRange("overview", 107)).toEqual({ min: 3, max: 7 });
    expect(stepRange("standard", 107)).toEqual({ min: 10, max: 20 });
    expect(stepRange("deep", 21)).toEqual({ min: 16, max: 21 });
    expect(stepRange("overview", 2)).toEqual({ min: 2, max: 2 });
  });
});

describe("placeUnits", () => {
  const range = stepRange("overview", notesUnits.atoms.length);
  const problems = (plan: PlanAnswer) => placeUnits(plan, notesUnits, range).problems;

  it("accepts a correct plan", () => {
    expect(problems(notesPlan())).toEqual([]);
  });

  it("finds units introduced too early, with the exact reason", () => {
    const plan = notesPlan();
    plan.milestones[1]!.steps.reverse(); // routes before store and validation
    expect(problems(plan)).toContain(
      "s02 introduces src/notes/notes.routes.ts#notesRouter, which needs src/notes/notes.validation.ts#parseNoteInput, introduced later in s03",
    );
  });

  it("finds missing, duplicated and unknown units", () => {
    const plan = notesPlan();
    plan.milestones[0]!.steps[0]!.introduces = ["src/config.ts", "src/errors.ts#HttpError", "src/nope.ts"];
    plan.milestones[2]!.steps[0]!.introduces.push("src/config.ts#loadConfig");
    const found = problems(plan);
    expect(found).toContain('s01 introduces "src/nope.ts", which is not in the unit list (use exact unit ids or file paths)');
    expect(found).toContain("src/errors.ts#errorHandler is never introduced");
    expect(found).toContain("src/config.ts#loadConfig is introduced more than once (s01, s05); introduce it in exactly one step");
  });

  it("lets a class bring its methods, or methods come in a later step", () => {
    const plan = notesPlan();
    const store = "src/notes/notes.store.ts";
    plan.milestones[1]!.steps[0]!.introduces = ["src/notes/note.ts", `${store}#NotesStore`];
    plan.milestones[1]!.steps[1]!.introduces.push(`${store}#NotesStore.remove`);
    expect(problems(plan)).toEqual([]);

    // …but never before the class.
    const early = notesPlan();
    early.milestones[0]!.steps[0]!.introduces.push(`${store}#NotesStore.remove`);
    expect(problems(early)).toContain(
      `s01 introduces ${store}#NotesStore.remove, which needs ${store}#NotesStore, introduced later in s02`,
    );
  });

  it("checks the number of steps", () => {
    const plan = notesPlan();
    plan.milestones = [{ ...plan.milestones[0]!, steps: [step(notesUnits.atoms.map((a) => a.file).filter((f, i, all) => all.indexOf(f) === i))] }];
    expect(problems(plan)).toContain("the plan has 1 steps; this size needs between 3 and 7");
  });
});

describe("toLearningPath", () => {
  const input = { track: "backend" as const, size: "overview" as const, units: notesUnits, summaries: summaries("express-notes"), hasTests: true };
  const options = { planning: { providerId: "claude-cli", model: "sonnet" }, now: () => new Date("2026-10-21T12:00:00.000Z") };

  it("computes ids, dependencies and file growth, and is a valid LearningPath", () => {
    const plan = notesPlan();
    const store = "src/notes/notes.store.ts";
    plan.milestones[1]!.steps[0]!.introduces = ["src/notes/note.ts", `${store}#NotesStore`];
    plan.milestones[1]!.steps[1]!.introduces.push(`${store}#NotesStore.remove`);

    const path = toLearningPath(input, plan, options);
    expect(learningPath.safeParse(path).success).toBe(true);
    expect(path.id).toBe("backend-overview");
    expect(path.steps.map((s) => s.id)).toEqual(["s01", "s02", "s03", "s04", "s05"]);
    expect(path.milestones.map((m) => m.stepIds)).toEqual([["s01"], ["s02", "s03", "s04"], ["s05"]]);
    expect(path.steps[3]!.dependsOn).toEqual(["s01", "s02", "s03"]); // routes need errors, store, validation
    expect(path.steps[2]!.introduces.find((u) => u.unit.endsWith("NotesStore.remove"))).toMatchObject({ kind: "method", change: "extend" });
    expect(path.steps[0]!.introduces[0]).toMatchObject({ unit: "src/config.ts", kind: "file", change: "add" });
  });

  it("refuses an invalid plan", () => {
    const plan = notesPlan();
    plan.milestones[1]!.steps.reverse();
    expect(() => toLearningPath(input, plan, options)).toThrow(/introduced later/);
  });
});

describe("planPrompt", () => {
  it("contains the range, the units with their needs, and the Express build order", () => {
    const prompt = planPrompt({ track: "backend", size: "standard", units: shopUnits, summaries: summaries("express-shop"), profile: profiles.express, hasTests: true });
    expect(prompt).toContain("between 10 and 20 steps");
    expect(prompt).toContain("src/orders/orders.service.ts#OrdersService.checkout (method");
    expect(prompt).toMatch(/OrdersService\.checkout \(method.*needs: .*ProductsService\.reserveStock/);
    expect(prompt).toContain("the server entry point that listens on a port");
    expect(prompt).toContain('prefer "existing-tests"');
  });
});

class ScriptedProvider implements AiProvider {
  readonly id = "scripted";
  readonly prompts: string[] = [];
  private readonly answers: unknown[];
  constructor(answers: unknown[]) {
    this.answers = answers;
  }
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.prompts.push(req.prompt);
    return { json: this.answers.shift(), usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0, durationMs: 1 };
  }
}

describe("generatePlan", () => {
  it("sends ordering problems back and returns the corrected path", async () => {
    const wrong = notesPlan();
    wrong.milestones[1]!.steps.reverse();
    const provider = new ScriptedProvider([wrong, notesPlan()]);
    const role = { providerId: "scripted", model: "big" };
    const client = new AiClient({ providers: [provider], roles: { summaries: role, planning: role, lessons: role } });
    const retries: string[][] = [];

    const { path, calls } = await generatePlan(
      client,
      { track: "backend", size: "overview", units: notesUnits, summaries: summaries("express-notes"), hasTests: true },
      { planning: role, onRetry: (p) => retries.push(p) },
    );
    expect(calls).toBe(2);
    expect(path.steps).toHaveLength(5);
    expect(retries[0]!.some((p) => p.includes("introduced later in s03"))).toBe(true);
    expect(provider.prompts[1]).toContain("introduced later in s03");
  });
});

describe("real plans from the fixtures", () => {
  it.each([
    ["express-notes", "overview"],
    ["express-notes", "standard"],
    ["express-shop", "standard"],
  ])("%s %s is a valid LearningPath that introduces every unit once, in order", (name, size) => {
    const path = learningPath.parse(fixture("plans", `${name}.${size}`));
    const units = buildUnits(graph(name));
    const answer: PlanAnswer = {
      milestones: path.milestones.map((m) => ({
        title: m.title,
        summary: m.summary,
        steps: m.stepIds.map((id) => {
          const s = path.steps.find((x) => x.id === id)!;
          return { ...step(s.introduces.map((u) => u.unit)), title: s.title };
        }),
      })),
    };
    expect(placeUnits(answer, units, stepRange(path.size, units.atoms.length)).problems).toEqual([]);
  });
});

describe("every step has behavior (design/08, improvement 1)", () => {
  const fromPath = (name: string, size: string) => {
    const path = learningPath.parse(fixture("plans", `${name}.${size}`));
    const answer: PlanAnswer = {
      milestones: path.milestones.map((m) => ({
        title: m.title,
        summary: m.summary,
        steps: m.stepIds.map((id) => step(path.steps.find((x) => x.id === id)!.introduces.map((u) => u.unit))),
      })),
    };
    const units = buildUnits(graph(name));
    return { answer, units, stepOf: placeUnits(answer, units, { min: 1, max: 999 }).stepOf };
  };

  it("knows which units a check can run", () => {
    const is = (id: string) => hasBehavior(notesUnits.byId.get(id)!);
    expect(is("src/notes/note.ts#Note")).toBe(false); // interface
    expect(is("src/notes/notes.validation.ts#isStringArray")).toBe(false); // private helper
    expect(is("src/notes/notes.store.ts#NotesStore.update")).toBe(true); // method of an exported class
    expect(is("src/server.ts")).toBe(true); // entry point
    expect(behaviorCount(notesUnits)).toBe(16);
  });

  it("flags the steps M1 couldn't prove: types only, or a private helper alone", () => {
    const flagged = (name: string) => {
      const { answer, units, stepOf } = fromPath(name, "standard");
      return stepsWithoutBehavior(answer, units, stepOf).map((p) => p.slice(0, p.indexOf(";")));
    };
    expect(flagged("express-notes")).toEqual([
      "s04 only introduces types or private code (src/notes/note.ts#Note, src/notes/note.ts#NoteInput)",
      "s07 only introduces types or private code (src/notes/notes.validation.ts#isStringArray)",
      "s09 only introduces types or private code (src/notes/notes.routes.ts#parseId)",
    ]);
    expect(flagged("express-no-tests")).toEqual([
      "s03 only introduces types or private code (src/links/link.ts#Link)",
      "s07 only introduces types or private code (src/links/links.service.ts#CreateLinkInput, src/links/links.service.ts#parseUrl)",
    ]);
    expect(flagged("express-shop")).toEqual([]);
  });

  it("sends such steps back to the AI, and refuses them in a new path", () => {
    const plan = notesPlan();
    // Interfaces alone, then the store that uses them.
    plan.milestones[1]!.steps.splice(0, 1, step(["src/notes/note.ts"]), step(["src/notes/notes.store.ts"]));
    const range = stepRange("overview", behaviorCount(notesUnits));
    const result = planSchema(notesUnits, range).safeParse(plan);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message)).toContainEqual(expect.stringMatching(/^s02 only introduces types or private code/));
    const input = { track: "backend" as const, size: "overview" as const, units: notesUnits, summaries: summaries("express-notes"), hasTests: true };
    expect(() => toLearningPath(input, plan, { planning: { providerId: "claude-cli", model: "sonnet" } })).toThrow(/only introduces types or private code/);
  });

  it("tells the planner which units are private and what the rule is", () => {
    const prompt = planPrompt({ track: "backend", size: "standard", units: notesUnits, summaries: summaries("express-notes"), hasTests: true });
    expect(prompt).toContain("src/notes/notes.validation.ts#isStringArray (function, ");
    expect(prompt).toMatch(/isStringArray \(function, \d+ lines, private\)/);
    expect(prompt).toContain("Every step introduces at least one exported function, class, method or value");
  });
});
