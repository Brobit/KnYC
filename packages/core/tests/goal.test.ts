import { describe, expect, it } from "vitest";
import graphFixture from "./fixtures/graphs/express-notes.json";
import planFixture from "./fixtures/plans/express-notes.standard.json";
import {
  AiClient,
  AiError,
  goalPrompt,
  graphSchema,
  learningPath,
  MAX_GOAL,
  MemoryHost,
  prepareChecks,
  type AiProvider,
  type ProviderRequest,
  type Scan,
  type Timeline,
} from "../src/index.ts";

const graph = graphSchema.parse(graphFixture);
const PATH = learningPath.parse(planFixture);
const STEP = PATH.steps[0]!;
const TEST_FILE = graph.files.find((f) => f.test)!.path;
const TEST_CODE = `describe("notes", () => {\n  it("caps titles at maxTitleLength", () => {\n    expect(parseNoteInput({ title: "x".repeat(81) }, 80).ok).toBe(false);\n  });\n});\n`;

const SCAN: Scan = {
  root: "/sandbox",
  hash: "blake3:abc",
  languages: [{ id: "typescript", files: 8, loc: 200 }],
  frameworks: [],
  testRunners: [{ runner: "vitest", root: "." }],
  packages: [],
  commands: [],
  toolchains: [],
  files: [],
  excluded: [],
  secretLines: [],
};

const TIMELINE: Timeline = {
  pathId: PATH.id,
  workDir: "/ref",
  steps: PATH.steps.map((s) => ({ stepId: s.id, ok: true, tag: `${PATH.id}/${s.id}`, durationMs: 1 })),
  finalMatchesOriginal: true,
  setupFixes: [],
};

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** A model for the goal call only: what it answers, and the prompts it got. */
function model(answer: (request: ProviderRequest) => unknown) {
  const prompts: string[] = [];
  const provider: AiProvider = {
    id: "claude-cli",
    async complete(request) {
      prompts.push(request.prompt);
      return { json: answer(request), usage, costUsd: null, durationMs: 1 };
    },
  };
  const role = { providerId: "claude-cli", model: "haiku" };
  return { prompts, client: new AiClient({ providers: [provider], roles: { summaries: role, planning: role, lessons: role } }) };
}

/**
 * The original of a file at a step: each symbol's line holds a declaration that takes
 * `maxTitleLength`, with a body after it the goal must never see.
 */
function originalCode(file: string): string {
  const node = graph.files.find((f) => f.path === file);
  const lines: string[] = Array.from({ length: Math.max(0, ...(node?.symbols.map((s) => s.endLine) ?? [0])) }, () => "  secretBodyLine();");
  for (const s of node?.symbols ?? []) lines[s.startLine - 1] = `export function ${s.name.replace(".", "_")}(store: Store, maxTitleLength: number) {`;
  return lines.join("\n");
}

/** Step 1 is checked by one of the project's tests (a saved mapping: nothing runs). */
async function stepOne(answer: (request: ProviderRequest) => unknown, options: { rewriteGoals?: boolean } = {}) {
  const host = new MemoryHost({
    files: { [`/sandbox/${TEST_FILE}`]: TEST_CODE },
    git: (_cwd, args) => (args[0] === "show" ? originalCode(args[1]!.split(":")[1]!) : ""),
  });
  const { client, prompts } = model(answer);
  const preparation = await prepareChecks(PATH, TIMELINE, graph, SCAN, {
    host,
    sourceRoot: "/sandbox",
    client,
    mapping: { byStep: new Map([[STEP.id, [`${TEST_FILE} › notes › caps titles at maxTitleLength`]]]), discarded: [] },
    ...options,
  });
  return { result: await preparation.forStep(STEP.id), prompts };
}

describe("goals rewritten from their checks (#84)", () => {
  it("asks for a goal that names what the checks call, from the checks' code", () => {
    const prompt = goalPrompt(STEP, [{ label: "caps titles", file: TEST_FILE, code: TEST_CODE }]);
    expect(prompt).toContain(`Current goal: ${STEP.goal}`);
    expect(prompt).toContain('"caps titles" runs');
    expect(prompt).toContain("parseNoteInput({ title");
    expect(prompt).toContain(`at most ${MAX_GOAL} characters`);
  });

  it("rewrites the goal once the step's checks are proven", async () => {
    const goal = "parseNoteInput(input, maxTitleLength) refuses a title longer than maxTitleLength.";
    const { result, prompts } = await stepOne(() => ({ goal }));
    expect(result.step.goal).toBe(goal);
    expect(result.report.notes).toContain("goal rewritten from its checks");
    expect(result.report.aiCalls).toBe(1);
    expect(prompts[0]).toContain("caps titles at maxTitleLength");
    // The original's declarations give the parameter names, without the bodies.
    expect(prompts[0]).toContain("# How the original declares what this step introduces");
    expect(prompts[0]).toContain("(store: Store, maxTitleLength: number)");
    expect(prompts[0]).not.toContain("secretBodyLine");
  });

  it("keeps the planner's goal when the answer is never valid", async () => {
    const { result } = await stepOne(() => ({ goal: "x".repeat(MAX_GOAL + 1) }));
    expect(result.step.goal).toBe(STEP.goal);
    expect(result.report.notes.some((n) => n.startsWith("goal kept:"))).toBe(true);
  });

  it("stops on a usage limit, like the checks themselves", async () => {
    await expect(
      stepOne(() => {
        throw new AiError("limit", "You've hit your session limit");
      }),
    ).rejects.toThrow("session limit");
  });

  it("can be turned off", async () => {
    const { result, prompts } = await stepOne(() => ({ goal: "never asked" }), { rewriteGoals: false });
    expect(result.step.goal).toBe(STEP.goal);
    expect(prompts).toEqual([]);
  });
});
