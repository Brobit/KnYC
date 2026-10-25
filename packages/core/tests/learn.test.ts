import { describe, expect, it } from "vitest";
import graphFixture from "./fixtures/graphs/express-notes.json";
import planFixture from "./fixtures/plans/express-notes.standard.json";
import summariesFixture from "./fixtures/summaries/express-notes.json";
import {
  AiClient,
  appendRuns,
  buildUnits,
  generateLesson,
  checkSources,
  filesForSkip,
  graphSchema,
  nextStepOf,
  stepStates,
  stepsSkippedBy,
  withCurrentStep,
  withPathComplete,
  withSkipped,
  withSnapshot,
  withTimeSpent,
  chatPrompt,
  explainPrompt,
  hintPrompt,
  withChat,
  nextHintLevel,
  stepChanges,
  withHint,
  withHintUsed,
  withReveal,
  knycPaths,
  latestRuns,
  learningPath,
  lessonPrompt,
  MemoryHost,
  newAnalysisJob,
  pathPaths,
  projectDocument,
  readProgress,
  referenceFiles,
  runStepChecks,
  startWorkspace,
  stepTags,
  syncPreparedSteps,
  withCheckAttempt,
  withPathChoice,
  workspaceStepChecks,
  type Check,
  type CheckCommand,
  type CheckOutcome,
  type CheckRun,
  type ProviderRequest,
  type Scan,
  type Summaries,
  type WorkspaceFiles,
} from "../src/index.ts";

const PATH = learningPath.parse(planFixture);
const PATH_ID = PATH.id;
const NOW = new Date("2026-10-23T09:00:00.000Z");

/** A workspace folder in a Map, like the Tauri workspace commands. */
function memoryFiles(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const files: WorkspaceFiles = {
    read: async (path) => {
      const content = map.get(path);
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    write: async (path, content) => void map.set(path, content),
    remove: async (path) => void map.delete(path),
    exists: async (path) => map.has(path) || [...map.keys()].some((k) => k.startsWith(`${path}/`)),
  };
  return { map, files };
}

const pass = (durationMs = 10): CheckOutcome => ({ status: "pass", run: { exitCode: 0, timedOut: false, durationMs, stdout: "ok", stderr: "", truncated: false } });
const fail = (stderr: string): CheckOutcome => ({ status: "fail", run: { exitCode: 1, timedOut: false, durationMs: 5, stdout: "", stderr, truncated: false } });

const generated = (id: string, file: string): Check => ({
  schemaVersion: 1,
  id,
  stepId: "s01",
  label: `generated ${id}`,
  origin: "generated",
  timeoutMs: 60_000,
  spec: { kind: "test", root: ".", runner: "other", command: `node --test ${file}`, filter: [], files: [file] },
});
const repo = (id: string, name: string): Check => ({
  schemaVersion: 1,
  id,
  stepId: "s01",
  label: name,
  origin: "repo",
  timeoutMs: 120_000,
  spec: { kind: "test", root: ".", runner: "vitest", command: "npx vitest run --reporter=json --outputFile=.knyc-report.json", filter: [name], files: [] },
});

describe("runStepChecks", () => {
  it("installs when needed, builds, runs the suite once and each generated check, then removes the copied files", async () => {
    const { map, files } = memoryFiles({
      [knycPaths(PATH_ID).checkFile(".knyc-checks/s01-1-1.test.mjs")]: "test('a')",
      [knycPaths(PATH_ID).testFile("tests/notes.test.ts")]: "describe('notes')",
      "package.json": "{}",
    });
    const calls: CheckCommand[] = [];
    const seenDuringRun: string[] = [];
    const run = async (request: CheckCommand): Promise<CheckOutcome> => {
      calls.push(request);
      seenDuringRun.push(...[...map.keys()].filter((k) => !k.startsWith(".knyc/")));
      if (request.command === "npm install") map.set("node_modules/.bin/x", "");
      if (request.command.startsWith("npx vitest")) {
        return {
          ...pass(),
          tests: {
            success: false,
            passed: 1,
            failed: 1,
            skipped: 0,
            tests: [
              { file: "tests/notes.test.ts", name: "lists notes", status: "pass", durationMs: 3 },
              { file: "tests/notes.test.ts", name: "creates a note", status: "fail", durationMs: 4, failure: { message: "expected 201", expected: "201", actual: "404" } },
            ],
          },
        };
      }
      return pass();
    };
    const results: CheckRun[] = [];
    const runs = await runStepChecks({
      checks: [repo("chk-s01-1", "lists notes"), repo("chk-s01-2", "creates a note"), generated("chk-s01-3", ".knyc-checks/s01-1-1.test.mjs")],
      pathId: PATH_ID,
      files,
      run,
      commands: { install: "npm install", build: "npm run build" },
      testFiles: ["tests/notes.test.ts"],
      onResult: (r) => results.push(r),
      now: () => NOW,
    });

    expect(calls.map((c) => c.command)).toEqual(["npm install", "npm run build", "npx vitest run --reporter=json --outputFile=.knyc-report.json", "node --test .knyc-checks/s01-1-1.test.mjs"]);
    expect(calls[2]!.report).toBe(".knyc-report.json");
    expect(calls[3]!.env).toEqual({ PORT: "0" });
    expect(runs.map((r) => r.status)).toEqual(["pass", "fail", "pass"]);
    expect(runs[1]!.failures).toEqual([{ message: "expected 201", expected: "201", actual: "404", file: "tests/notes.test.ts" }]);
    expect(results.map((r) => r.checkId)).toEqual(["chk-s01-1", "chk-s01-2", "chk-s01-3"]);
    // The test files were there while the checks ran, and are gone after.
    expect(seenDuringRun).toContain(".knyc-checks/s01-1-1.test.mjs");
    expect(seenDuringRun).toContain("tests/notes.test.ts");
    expect(map.has(".knyc-checks/s01-1-1.test.mjs")).toBe(false);
    expect(map.has("tests/notes.test.ts")).toBe(false);
  });

  it("fails every check with the build errors when the project doesn't build", async () => {
    const { files } = memoryFiles({ "node_modules/x": "" });
    const calls: string[] = [];
    const build: Check = { schemaVersion: 1, id: "chk-s01-2", stepId: "s01", label: "The project builds", origin: "generated", timeoutMs: 1000, spec: { kind: "build", root: ".", command: "npm run build" } };
    const runs = await runStepChecks({
      checks: [generated("chk-s01-1", ".knyc-checks/a.test.mjs"), build],
      pathId: PATH_ID,
      files,
      run: async (r) => (calls.push(r.command), fail("src/app.ts(3,1): error TS2304: Cannot find name 'notes'.")),
      commands: { install: "npm install", build: "npm run build" },
      now: () => NOW,
    });
    expect(calls).toEqual(["npm run build"]);
    expect(runs.map((r) => r.status)).toEqual(["fail", "fail"]);
    expect(runs[0]!.failures[0]!.message).toContain("doesn't build yet");
    expect(runs[0]!.failures[0]!.message).toContain("Cannot find name 'notes'");
  });
});

describe("runs and progress", () => {
  it("keeps the last runs of a step, the latest per check, and counts attempts", async () => {
    const { files } = memoryFiles();
    const run = (checkId: string, status: CheckRun["status"], at: string): CheckRun => ({ checkId, at, status, durationMs: 1, output: "", failures: [] });
    await appendRuns(files, PATH_ID, "s01", [run("chk-s01-1", "fail", "2026-10-23T09:00:00.000Z")], 2);
    await appendRuns(files, PATH_ID, "s01", [run("chk-s01-1", "pass", "2026-10-23T09:01:00.000Z"), run("chk-s01-2", "pass", "2026-10-23T09:01:00.000Z")], 2);
    expect((await files.read(knycPaths(PATH_ID).runs("s01"))).trim().split("\n")).toHaveLength(2);
    const latest = await latestRuns(files, PATH_ID, "s01");
    expect([...latest.values()].map((r) => `${r.checkId}:${r.status}`)).toEqual(["chk-s01-1:pass", "chk-s01-2:pass"]);

    const { files: ws } = memoryFiles();
    await startWorkspace(ws, { project: project(), path: PATH, setup: new Map(), now: NOW });
    const progress = (await readProgress(ws))!;
    const once = withCheckAttempt(progress, PATH_ID, "s01", false, NOW);
    expect(once.paths[PATH_ID]!.steps.s01).toMatchObject({ status: "in-progress", attempts: 1, startedAt: NOW.toISOString() });
    const twice = withCheckAttempt(once, PATH_ID, "s01", true, new Date("2026-10-23T09:30:00.000Z"));
    expect(twice.paths[PATH_ID]!.steps.s01).toMatchObject({ status: "passed", attempts: 2, passedAt: "2026-10-23T09:30:00.000Z" });
  });
});

const SCAN: Scan = {
  root: "/s",
  hash: "blake3:abc",
  languages: [{ id: "typescript", files: 8, loc: 200 }],
  frameworks: [],
  testRunners: [],
  packages: [],
  commands: [{ root: ".", install: "npm install", build: "npm run build", test: null, run: null } as unknown as Scan["commands"][number]],
  toolchains: [],
  files: [],
  excluded: [],
  secretLines: [],
};
const project = () => projectDocument({ path: "/code/express-notes", hash: "blake3:abcdef" }, SCAN, buildUnits(graphSchema.parse(graphFixture)), "backend", NOW);

describe("the learner's workspace", () => {
  it("starts from the setup, then copies each step's checks once it is prepared", async () => {
    const { map, files } = memoryFiles();
    await startWorkspace(files, { project: project(), path: PATH, setup: new Map([["package.json", '{"name":"notes"}']]), now: NOW });
    expect(map.get("package.json")).toBe('{"name":"notes"}');
    expect(JSON.parse(map.get(".knyc/project.json")!).source.hash).toBe("blake3:abcdef");
    expect((await readProgress(files))?.paths[PATH_ID]?.currentStepId).toBe("s01");
    expect(await workspaceStepChecks(files, PATH, "s01")).toEqual([]);

    // Step 1 is prepared: its checks and generated files are copied, once.
    const ready = { ...PATH, steps: PATH.steps.map((s, i) => (i === 0 ? { ...s, prep: "checks-ready" as const, checkIds: ["chk-s01-1"] } : s)) };
    const loads: string[] = [];
    const load = async (stepId: string) => (loads.push(stepId), { checks: [generated("chk-s01-1", ".knyc-checks/s01.test.mjs")], files: new Map([[".knyc-checks/s01.test.mjs", "test()"]]) });
    expect(await syncPreparedSteps(files, ready, load)).toEqual(["s01"]);
    expect(await syncPreparedSteps(files, ready, load)).toEqual([]);
    expect(loads).toEqual(["s01"]);
    expect(map.get(knycPaths(PATH_ID).checkFile(".knyc-checks/s01.test.mjs"))).toBe("test()");
    expect((await workspaceStepChecks(files, ready, "s01")).map((c) => c.id)).toEqual(["chk-s01-1"]);
    expect(JSON.parse(map.get(knycPaths(PATH_ID).path)!).steps[0].prep).toBe("checks-ready");

    // Reopened later: the learner's code and progress stay.
    map.set("package.json", '{"name":"notes","edited":true}');
    await startWorkspace(files, { project: project(), path: ready, setup: new Map([["package.json", "{}"]]), now: new Date("2026-10-24T09:00:00.000Z") });
    expect(map.get("package.json")).toBe('{"name":"notes","edited":true}');
    expect((await readProgress(files))?.paths[PATH_ID]?.startedAt).toBe(NOW.toISOString());
  });

  it("reads the reference at a tag from git objects, and finds the tags around a step", async () => {
    const host = new MemoryHost({
      git: (_cwd, args) => {
        if (args[0] === "ls-tree") return "package.json\ntsconfig.json\n";
        if (args[0] === "show") return `content of ${args[1]}`;
        return "";
      },
    });
    const files = await referenceFiles(host, "/ref", "backend-standard/s00");
    expect([...files]).toEqual([
      ["package.json", "content of backend-standard/s00:package.json"],
      ["tsconfig.json", "content of backend-standard/s00:tsconfig.json"],
    ]);
    expect(host.gitCalls.every((c) => c.args[0] === "ls-tree" || c.args[0] === "show")).toBe(true);

    const job = withPathChoice(newAnalysisJob({ source: "/s", sourceHash: "blake3:ab", name: "n" }, { id: "j", dataDir: "/d" }), { track: "backend", size: "standard", setupAsStep: false });
    const paths = pathPaths(job.cacheDir, "backend-standard");
    await host.writeFile(
      paths.timeline,
      JSON.stringify({
        pathId: "backend-standard",
        workDir: paths.workDir,
        steps: [
          { stepId: "s01", ok: true, tag: "backend-standard/s01", durationMs: 1 },
          { stepId: "s02", ok: false, mergedInto: "s03", durationMs: 1 },
          { stepId: "s03", ok: true, tag: "backend-standard/s03", durationMs: 1 },
        ],
        finalMatchesOriginal: true,
        setupFixes: [],
      }),
    );
    expect(await stepTags(host, job, "s01")).toEqual({ workDir: paths.workDir, before: "backend-standard/s00", after: "backend-standard/s01" });
    expect(await stepTags(host, job, "s02")).toMatchObject({ before: "backend-standard/s01", after: "backend-standard/s03" });
    expect(await stepTags(host, job, "s03")).toMatchObject({ before: "backend-standard/s01", after: "backend-standard/s03" });
  });
});

describe("lessons", () => {
  const summaries = summariesFixture as Summaries;
  const input = { projectName: "express-notes", path: PATH, stepId: PATH.steps[1]!.id, summaries, diff: "+export function loadConfig() {}" };

  it("gives the model the step, what came before and the original's change, and asks not to copy it", () => {
    const prompt = lessonPrompt(input);
    const step = PATH.steps[1]!;
    expect(prompt).toContain(step.goal);
    expect(prompt).toContain(`- ${PATH.steps[0]!.id} ${PATH.steps[0]!.title} (done)`);
    expect(prompt).toContain("+export function loadConfig() {}");
    expect(prompt).toContain("Never paste the original's code");
  });

  it("shows the model the step's checks and asks for what they expect (#66)", () => {
    const without = lessonPrompt(input);
    expect(without).not.toContain("# The checks the learner's code must pass");
    const prompt = lessonPrompt({ ...input, checks: [{ label: "store creates notes", file: "tests/notes.store.test.ts", code: "new NotesStore(fixedNow)" }] });
    expect(prompt).toContain('# The checks the learner\'s code must pass (for you only)\n"store creates notes" runs tests/notes.store.test.ts:');
    expect(prompt).toContain("new NotesStore(fixedNow)");
    expect(prompt).toContain("**What the checks expect**");
  });

  it("finds the code behind generated and repo checks", () => {
    const test = (id: string, origin: "repo" | "generated", spec: { filter?: string[]; files?: string[] }) => ({
      schemaVersion: 1 as const,
      id,
      stepId: "s05",
      label: id,
      origin,
      timeoutMs: 1000,
      spec: { kind: "test" as const, root: ".", runner: "vitest" as const, command: "npx vitest run", filter: spec.filter ?? [], files: spec.files ?? [] },
    });
    const storeTest = `describe("NotesStore", () => {\n  it("filters by tag", () => {});\n  it('creates notes', () => {});\n});`;
    const sources = checkSources(
      [
        test("repo-1", "repo", { filter: ["NotesStore filters by tag"] }),
        test("repo-2", "repo", { filter: ["NotesStore creates notes"] }),
        test("gen-1", "generated", { files: [".knyc-checks/s05-1-1.test.mjs", ".knyc-checks/missing.test.mjs"] }),
      ],
      new Map([[".knyc-checks/s05-1-1.test.mjs", "assert.equal(1, 1);"]]),
      new Map([
        ["tests/notes.store.test.ts", storeTest],
        ["tests/notes.api.test.ts", `it("returns ok", () => {});`],
      ]),
    );
    expect(sources).toEqual([
      { label: "repo-1", file: "tests/notes.store.test.ts", code: storeTest },
      { label: "gen-1", file: ".knyc-checks/s05-1-1.test.mjs", code: "assert.equal(1, 1);" },
    ]);
  });

  it("makes a lesson document with no hints or chat yet", async () => {
    const model = { providerId: "claude-cli", model: "sonnet" };
    const client = new AiClient({
      providers: [
        {
          id: "claude-cli",
          complete: async (_request: ProviderRequest) => ({
            json: { explanation: "## Configuration\n\nRead the port from the environment with a default, and export `loadConfig` so the server can use it.", architectureNote: "Used by src/server.ts." },
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            costUsd: null,
            durationMs: 1,
          }),
        },
      ],
      roles: { summaries: model, planning: model, lessons: model },
    });
    const lesson = await generateLesson(client, input, { model, now: NOW });
    expect(lesson).toMatchObject({ schemaVersion: 1, stepId: input.stepId, generatedWith: model, at: NOW.toISOString(), architectureNote: "Used by src/server.ts.", hints: [], chat: [] });
  });
});

describe("hints and reveal", () => {
  const summaries = summariesFixture as Summaries;
  const base = { projectName: "express-notes", path: PATH, stepId: PATH.steps[0]!.id, summaries, diff: "+export function loadConfig() {}" };

  it("asks for the level wanted, from the learner's code, the failures and the hints before", () => {
    const prompt = hintPrompt({
      ...base,
      level: 2,
      earlier: [{ level: 1, text: "Look at what the server imports.", unlockedAt: NOW.toISOString() }],
      learnerFiles: new Map([
        ["src/config.ts", "export const port = 3000;"],
        ["src/errors.ts", null],
      ]),
      failures: ["config works: loadConfig is not a function"],
    });
    expect(prompt).toContain("Hint 2, the approach");
    expect(prompt).not.toContain("Hint 1, a nudge");
    expect(prompt).toContain("export const port = 3000;");
    expect(prompt).toContain("## src/errors.ts\n(not written yet)");
    expect(prompt).toContain("- config works: loadConfig is not a function");
    expect(prompt).toContain("- Hint 1: Look at what the server imports.");
    expect(prompt).toContain(PATH.steps[0]!.goal);
    expect(prompt).not.toContain("Write the lesson as JSON");
  });

  it("counts each rung once, in order, and the reveal", async () => {
    const { files } = memoryFiles();
    await startWorkspace(files, { project: project(), path: PATH, setup: new Map(), now: NOW });
    let progress = (await readProgress(files))!;
    expect(nextHintLevel(progress.paths[PATH_ID]!.steps.s01)).toBe(1);
    progress = withHintUsed(progress, PATH_ID, "s01", 1);
    progress = withHintUsed(progress, PATH_ID, "s01", 1);
    progress = withHintUsed(progress, PATH_ID, "s01", 2);
    expect(progress.paths[PATH_ID]!.steps.s01).toMatchObject({ status: "in-progress", hintsUsed: [1, 2], revealed: false });
    expect(nextHintLevel(progress.paths[PATH_ID]!.steps.s01)).toBe(3);
    progress = withReveal(withHintUsed(progress, PATH_ID, "s01", 3), PATH_ID, "s01");
    expect(progress.paths[PATH_ID]!.steps.s01).toMatchObject({ hintsUsed: [1, 2, 3], revealed: true });
    expect(nextHintLevel(progress.paths[PATH_ID]!.steps.s01)).toBeNull();

    const lesson = { schemaVersion: 1 as const, stepId: "s01", generatedWith: { providerId: "claude-cli", model: "sonnet" }, at: NOW.toISOString(), explanation: "x".repeat(90), hints: [], chat: [] };
    const two = withHint(withHint(lesson, 2, "second", NOW), 1, "first", NOW);
    expect(two.hints.map((h) => `${h.level}:${h.text}`)).toEqual(["1:first", "2:second"]);
    expect(withHint(two, 2, "again", NOW).hints.map((h) => h.text)).toEqual(["first", "again"]);
  });

  it("lists what the original changes in a step, file by file", async () => {
    const host = new MemoryHost({
      git: (_cwd, args) => {
        if (args[0] === "diff") return "src/config.ts\nsrc/server.ts\n";
        if (args[1] === "p/s00:src/server.ts") return "import './app.js';\n";
        if (args[1]?.startsWith("p/s01:")) return `after ${args[1].slice(6)}`;
        throw new Error("fatal: path does not exist");
      },
    });
    expect(await stepChanges(host, "/ref", "p/s00", "p/s01")).toEqual([
      { path: "src/config.ts", before: null, after: "after src/config.ts" },
      { path: "src/server.ts", before: "import './app.js';\n", after: "after src/server.ts" },
    ]);
  });
});

describe("explain this failure and the step chat", () => {
  const summaries = summariesFixture as Summaries;
  const base = { projectName: "express-notes", path: PATH, stepId: PATH.steps[0]!.id, summaries, diff: "+export function loadConfig() {}" };
  const learnerFiles = new Map<string, string | null>([["src/config.ts", "export const port = 3000;"]]);

  it("gives the real error and the learner's code, and asks for an explanation without the fix", () => {
    const prompt = explainPrompt({ ...base, check: "loadConfig reads PORT", failure: "TypeError: loadConfig is not a function\n    at test.mjs:3", learnerFiles });
    expect(prompt).toContain('# The failing check: "loadConfig reads PORT"');
    expect(prompt).toContain("TypeError: loadConfig is not a function");
    expect(prompt).toContain("export const port = 3000;");
    expect(prompt).toContain("Don't write the fix for them");
  });

  it("keeps the recent conversation and the lesson as the chat's context", () => {
    const history = Array.from({ length: 14 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `message ${i}`, at: NOW.toISOString() }));
    const prompt = chatPrompt({ ...base, lesson: "Export loadConfig.", learnerFiles, history, question: "Why a function and not a constant?" });
    expect(prompt).toContain("# The lesson the learner read\nExport loadConfig.");
    expect(prompt).not.toContain("message 1\n");
    expect(prompt).toContain("Learner: message 2");
    expect(prompt).toContain("You: message 13");
    expect(prompt).toContain("# The learner asks\nWhy a function and not a constant?");
  });

  it("adds an exchange to the step's chat", () => {
    const lesson = { schemaVersion: 1 as const, stepId: "s01", generatedWith: { providerId: "claude-cli", model: "sonnet" }, at: NOW.toISOString(), explanation: "x".repeat(90), hints: [], chat: [] };
    expect(withChat(lesson, "Why?", "Because.", NOW).chat).toEqual([
      { role: "user", content: "Why?", at: NOW.toISOString() },
      { role: "assistant", content: "Because.", at: NOW.toISOString() },
    ]);
  });
});

describe("moving through the path", () => {
  it("passes a step with its snapshot, opens the next, skips with the original's code, counts time", async () => {
    const { files } = memoryFiles();
    await startWorkspace(files, { project: project(), path: PATH, setup: new Map(), now: NOW });
    const [s1, s2, s3, s4] = PATH.steps.map((s) => s.id) as [string, string, string, string];
    let progress = withCheckAttempt((await readProgress(files))!, PATH_ID, s1, true, NOW);
    progress = withCurrentStep(withSnapshot(progress, PATH_ID, s1, "abc123"), PATH_ID, nextStepOf(PATH, s1)!.id, NOW);
    expect(progress.paths[PATH_ID]!.currentStepId).toBe(s2);
    expect(progress.paths[PATH_ID]!.steps[s1]).toMatchObject({ status: "passed", snapshot: "abc123" });
    expect(progress.paths[PATH_ID]!.steps[s2]).toMatchObject({ status: "available", startedAt: NOW.toISOString() });

    // A jump from s2 to s4 skips s2 and s3; a passed step stays passed.
    expect(stepsSkippedBy(PATH, s2, s4)).toEqual([s2, s3]);
    expect(stepsSkippedBy(PATH, s2, s1)).toEqual([]);
    progress = withCurrentStep(withSkipped(progress, PATH_ID, [s1, s2, s3]), PATH_ID, s4, NOW);
    const states = stepStates(PATH, progress.paths[PATH_ID]);
    expect([states.get(s1), states.get(s2), states.get(s3), states.get(s4), states.get(PATH.steps[4]!.id)]).toEqual(["passed", "skipped", "skipped", "current", "locked"]);

    progress = withTimeSpent(withTimeSpent(progress, PATH_ID, s4, 30.4), PATH_ID, s4, 30);
    expect(progress.paths[PATH_ID]!.steps[s4]!.timeSpentSec).toBe(60);
    expect(withPathComplete(progress, PATH_ID, NOW).paths[PATH_ID]!.completedAt).toBe(NOW.toISOString());

    expect([
      ...filesForSkip([
        [{ path: "src/config.ts", before: null, after: "v1" }],
        [
          { path: "src/config.ts", before: "v1", after: "v2" },
          { path: "src/old.ts", before: "x", after: null },
        ],
      ]),
    ]).toEqual([
      ["src/config.ts", "v2"],
      ["src/old.ts", null],
    ]);
  });
});
