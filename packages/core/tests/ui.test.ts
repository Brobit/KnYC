import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  AiClient,
  appendRuns,
  browserStatus,
  buildUnits,
  describeUiProblem,
  generic,
  graphProject,
  knycPaths,
  learningPath,
  prepareChecks,
  profiles,
  runCommand,
  runStepChecks,
  runUiCheck,
  scanProject,
  uiChecksPrompt,
  uiRun,
  uiTestModule,
  type AiProvider,
  type Check,
  type Timeline,
  type UiOutcome,
  type WorkspaceFiles,
} from "../src/index.ts";
import { findKnycSys, NodeHost, sysArgs } from "../src/node.ts";

const at = "2026-10-26T12:00:00.000Z";
const server = { start: "npm run dev", root: ".", port: 5173, readyPath: "/" };

const failed: UiOutcome = {
  status: "fail",
  port: 5173,
  tests: [
    {
      file: ".knyc-checks/s02-ui-1-1.ui.mjs",
      status: "fail",
      durationMs: 5200,
      error: "locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Add' })",
      url: "http://localhost:5173/",
      pageErrors: ["Failed to load module script"],
      snapshot: '- heading "Counter" [level=1]',
      screenshot: "AAAA",
    },
  ],
  output: "VITE v8.3.5 ready",
  durationMs: 6100,
};
const passed: UiOutcome = { status: "pass", port: 5173, tests: [{ file: ".knyc-checks/s02-ui-1-1.ui.mjs", status: "pass", durationMs: 900, pageErrors: [] }], output: "", durationMs: 2100 };

describe("UI checks (#89)", () => {
  it("wrap the model's test body in a module the runner calls with a page", () => {
    const code = uiTestModule("Add increments the count", 'await page.goto("/");\nawait page.getByRole("button", { name: "Add" }).click();');
    expect(code).toBe(
      '// KnYC UI check: Add increments the count\nimport assert from "node:assert/strict";\n\nexport default async function ({ page }) {\n  await page.goto("/");\n  await page.getByRole("button", { name: "Add" }).click();\n}\n',
    );
  });

  it("ask for tests a user could do, on what the step makes visible", () => {
    const prompt = uiChecksPrompt(
      { step: { id: "s02", title: "Render the counter", goal: "The page shows Count: 0 and an Add button that increments it" } as never, diff: "+<button>Add</button>", importPaths: new Map(), dependencies: [], exports: new Map(), context: new Map([["src/counter.js", "export const increment = (n) => n + 1;"]]) },
      ['"x" already passes before the step: it doesn\'t prove the step'],
    );
    expect(prompt).toContain("Goal: The page shows Count: 0");
    expect(prompt).toContain("+<button>Add</button>");
    expect(prompt).toContain("--- src/counter.js");
    expect(prompt).toContain("getByRole");
    expect(prompt).toContain('- "x" already passes before the step');
  });

  it("are proven only when they fail before the step and pass at it", () => {
    expect(describeUiProblem("Add increments", passed, failed)).toBeUndefined();
    expect(describeUiProblem("Add increments", passed, passed)).toContain("already passes before the step");
    const problem = describeUiProblem("Add increments", failed, null)!;
    expect(problem).toContain('"Add increments" fails after the step: locator.click: Timeout 5000ms exceeded.');
    expect(problem).toContain("the page logged: Failed to load module script");
    expect(problem).toContain('the page showed:\n- heading "Counter" [level=1]');
  });

  it("show the learner the error, what the page logged and showed, and a screenshot", () => {
    const run = uiRun("chk-s02-1", failed, at);
    expect(run).toMatchObject({ checkId: "chk-s02-1", status: "fail", durationMs: 6100, screenshot: "data:image/jpeg;base64,AAAA" });
    expect(run.failures).toEqual([
      {
        message:
          "locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Add' })\n\nThe page logged:\n- Failed to load module script\n\nThe page (http://localhost:5173/) showed:\n- heading \"Counter\" [level=1]",
        file: ".knyc-checks/s02-ui-1-1.ui.mjs",
      },
    ]);
    expect(run.output).toBe("✗ .knyc-checks/s02-ui-1-1.ui.mjs (5200 ms)\n\nOutput:\nVITE v8.3.5 ready");
    const unavailable = uiRun("chk-s02-1", { status: "unavailable", tests: [], output: "", error: "Chromium isn't downloaded yet", durationMs: 3 }, at);
    expect(unavailable.status).toBe("error");
    expect(unavailable.failures[0]!.message).toBe("This check runs in Chromium, which isn't ready: Chromium isn't downloaded yet");
    expect(uiRun("chk-s02-1", passed, at)).toMatchObject({ status: "pass", failures: [] });
  });

  it("keep screenshots out of the runs file", async () => {
    const stored = new Map<string, string>();
    const files: WorkspaceFiles = { read: async (p) => stored.get(p)!, write: async (p, c) => void stored.set(p, c), remove: async () => {}, exists: async (p) => stored.has(p) };
    await appendRuns(files, "p", "s02", [uiRun("chk-s02-1", failed, at)]);
    const line = JSON.parse(stored.get(knycPaths("p").runs("s02"))!.trim());
    expect(line.screenshot).toBeUndefined();
    expect(line.failures[0].message).toContain("locator.click");
  });

  it("copy the UI tests into the workspace only while they run", async () => {
    const stored = new Map<string, string>([[knycPaths("p").checkFile(".knyc-checks/s02-ui-1-1.ui.mjs"), "export default async () => {}"]]);
    const files: WorkspaceFiles = { read: async (p) => stored.get(p)!, write: async (p, c) => void stored.set(p, c), remove: async (p) => void stored.delete(p), exists: async (p) => stored.has(p) };
    const check: Check = { schemaVersion: 1, id: "chk-s02-1", stepId: "s02", label: "Add increments the count", origin: "generated", timeoutMs: 90_000, spec: { kind: "ui", server, files: [".knyc-checks/s02-ui-1-1.ui.mjs"] } };
    const seen: string[] = [];
    const results = await runStepChecks({
      checks: [check],
      pathId: "p",
      files,
      run: async () => ({ status: "pass" }),
      runUi: async (request) => {
        seen.push(`${request.root} ${request.server.start} ${request.files.join(",")} ${stored.has(".knyc-checks/s02-ui-1-1.ui.mjs")}`);
        return passed;
      },
    });
    expect(seen).toEqual([". npm run dev .knyc-checks/s02-ui-1-1.ui.mjs true"]);
    expect(results[0]!.status).toBe("pass");
    expect(stored.has(".knyc-checks/s02-ui-1-1.ui.mjs")).toBe(false);
    expect(stored.has(".knyc-checks")).toBe(false);
  });

  it("go to knyc-sys with the server, the tests and KnYC's Chromium folder", () => {
    expect(sysArgs({ op: "ui", cwd: "/w", timeoutMs: 90_000, server, tests: ["/w/.knyc-checks/a.ui.mjs"], browsers: "/data/browsers" })).toEqual([
      "ui",
      "--cwd",
      "/w",
      "--timeout-ms",
      "90000",
      "--spec",
      JSON.stringify({ server, tests: ["/w/.knyc-checks/a.ui.mjs"] }),
      "--browsers",
      "/data/browsers",
    ]);
    expect(sysArgs({ op: "browser", action: "size", browsers: "/data/browsers" })).toEqual(["browser", "size", "--browsers", "/data/browsers"]);
  });
});

// The Done when: a React step checked by a real-browser test that fails before the step and passes
// after it, through the check pipeline (a scripted model) and then on the learner's side. Needs
// knyc-sys and Chromium 1243 in Playwright's cache (or KNYC_TEST_BROWSERS); skipped without them.
const knycSys = findKnycSys();
const playwrightCache =
  process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright") : process.platform === "darwin" ? join(homedir(), "Library/Caches/ms-playwright") : join(homedir(), ".cache/ms-playwright");
const browsers = process.env.KNYC_TEST_BROWSERS ?? playwrightCache;
const chromium = knycSys ? await browserStatus(new NodeHost({ binary: knycSys }), browsers).then((s) => s.installed, () => false) : false;

const REPO: Record<string, Record<string, string>> = {
  s00: {
    ".gitignore": "node_modules/\ndist/\n",
    "package.json": JSON.stringify({ name: "react-counter", private: true, type: "module", scripts: { dev: "vite", build: "vite build" }, dependencies: { react: "19.3.1", "react-dom": "19.3.1" }, devDependencies: { vite: "8.3.5" } }, null, 2),
    // Until the React profile (#92) passes --port, the fixture reads PORT itself.
    "vite.config.js": 'export default { server: { port: Number(process.env.PORT) || 5173, strictPort: true } };\n',
    "index.html": '<!doctype html>\n<html><head><title>Counter</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n',
  },
  s01: { "src/counter.js": "export function increment(count) {\n  return count + 1;\n}\n" },
  s02: {
    "src/App.jsx":
      'import { useState } from "react";\nimport { increment } from "./counter.js";\n\nexport function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <main>\n      <h1>Counter</h1>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(increment)}>Add</button>\n    </main>\n  );\n}\n',
    "src/main.jsx": 'import { createRoot } from "react-dom/client";\nimport { App } from "./App.jsx";\n\ncreateRoot(document.getElementById("root")).render(<App />);\n',
  },
};

describe.skipIf(!chromium)("a React step checked in Chromium (#89 Done when)", () => {
  // The long path: Vite refuses files under a Windows short name (ALANNM~1) as outside its root.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "knyc-ui-")));
  afterAll(() => {
    delete profiles.react;
    rmSync(dir, { recursive: true, force: true });
  });

  it("proves a UI test red → green, then runs it for the learner", async () => {
    const ref = join(dir, "ref");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: ref, stdio: "pipe" }).toString();
    mkdirSync(ref);
    git("init", "-q");
    git("config", "user.email", "knyc@example.com");
    git("config", "user.name", "KnYC");
    for (const [tag, files] of Object.entries(REPO)) {
      for (const [file, code] of Object.entries(files)) {
        mkdirSync(dirname(join(ref, file)), { recursive: true });
        writeFileSync(join(ref, file), code);
      }
      git("add", "-A");
      git("commit", "-qm", tag);
      git("tag", `p/${tag}`);
    }
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: ref, stdio: "pipe", shell: process.platform === "win32" });

    const host = new NodeHost({ binary: knycSys });
    const scan = await scanProject(host, ref, { toolchains: false });
    const graph = await graphProject(host, ref);
    // A stand-in until the React profile (#92): how to start the frontend.
    profiles.react = { ...generic, id: "react", label: "React", kind: "frontend", run: { scripts: ["dev"], readyPaths: ["/"], port: 5173, portEnv: "PORT" } };

    const units = buildUnits(graph);
    const inStep2 = (file: string) => file === "src/App.jsx" || file === "src/main.jsx";
    const introduces = (step2: boolean) => units.atoms.filter((a) => inStep2(a.file) === step2).map((a) => ({ unit: a.id, kind: a.kind === "function" ? ("function" as const) : ("other" as const), change: "add" as const }));
    const step = (id: string, index: number, title: string, goal: string, step2: boolean, checkStrategy: "unit-test" | "ui") => ({
      id,
      index,
      title,
      goal,
      concepts: [],
      introduces: introduces(step2),
      dependsOn: [],
      checkIds: [],
      estimatedMinutes: 10,
      prep: "planned",
      checkStrategy,
    });
    const path = learningPath.parse({
      schemaVersion: 1,
      id: "p",
      trackId: "frontend",
      size: "overview",
      setupAsStep: false,
      sharedUnits: [],
      generatedWith: { planning: { providerId: "claude-cli", model: "sonnet" }, at },
      status: "preparing",
      milestones: [{ id: "m1", title: "The counter", summary: "A counter you can click.", stepIds: ["s01", "s02"] }],
      steps: [step("s01", 0, "Count up", "increment(n) returns n + 1", false, "unit-test"), step("s02", 1, "Render the counter", "The page shows Count: 0 and an Add button that adds one", true, "ui")],
    });
    const timeline: Timeline = {
      pathId: "p",
      workDir: ref,
      steps: [
        { stepId: "s01", ok: true, tag: "p/s01", durationMs: 1 },
        { stepId: "s02", ok: true, tag: "p/s02", durationMs: 1 },
      ],
      finalMatchesOriginal: true,
      setupFixes: [],
    };

    // The model: first a test that already passes before the step (the page title is there from
    // the setup), then one the step makes pass.
    const answers = [
      { checks: [{ label: "The page is titled Counter", body: 'await page.goto("/");\nassert.equal(await page.title(), "Counter");' }] },
      { checks: [{ label: "Add increments the count", body: 'await page.goto("/");\nawait page.getByText("Count: 0").waitFor();\nawait page.getByRole("button", { name: "Add" }).click();\nawait page.getByText("Count: 1").waitFor();' }] },
    ];
    const prompts: string[] = [];
    const provider: AiProvider = {
      id: "claude-cli",
      async complete(request) {
        prompts.push(request.prompt);
        return { json: answers[prompts.length - 1], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: null, durationMs: 1 };
      },
    };
    const role = { providerId: "claude-cli", model: "haiku" };
    const client = new AiClient({ providers: [provider], roles: { summaries: role, planning: role, lessons: role } });

    const preparation = await prepareChecks(path, timeline, graph, scan, { host, sourceRoot: ref, client, rewriteGoals: false, ui: { browsers }, mapping: { byStep: new Map(), discarded: [] } });
    const result = await preparation.forStep("s02");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('"The page is titled Counter" already passes before the step');
    expect(result.report).toMatchObject({ strength: "strong", generated: 1 });
    expect(result.checks).toHaveLength(1);
    const check = result.checks[0]!;
    expect(check).toMatchObject({ label: "Add increments the count", spec: { kind: "ui", server: { start: "npm run dev", root: ".", port: 5173 } } });
    const file = (check.spec as Extract<Check["spec"], { kind: "ui" }>).files[0]!;
    expect(result.files.get(file)).toContain('await page.getByRole("button", { name: "Add" }).click();');

    // The learner's side: the check stored in .knyc, run at the step (green) and before it (red).
    const files: WorkspaceFiles = {
      read: async (p) => readFileSync(join(ref, p), "utf8"),
      write: async (p, c) => (mkdirSync(dirname(join(ref, p)), { recursive: true }), writeFileSync(join(ref, p), c)),
      remove: async (p) => rmSync(join(ref, p), { recursive: true, force: true }),
      exists: async (p) => existsSync(join(ref, p)),
    };
    const learnerRun = async () => {
      await files.write(knycPaths("p").checkFile(file), result.files.get(file)!);
      return runStepChecks({
        checks: result.checks,
        pathId: "p",
        files,
        run: (r) => runCommand(host, r.root === "." ? ref : join(ref, r.root), r.command, { timeoutMs: r.timeoutMs }),
        runUi: (r) => runUiCheck(host, r.root === "." ? ref : join(ref, r.root), r.server, r.files.map((f) => join(ref, f)), browsers, r.timeoutMs),
      });
    };
    git("checkout", "-qf", "p/s02");
    const green = await learnerRun();
    expect(green[0]).toMatchObject({ status: "pass", failures: [] });
    expect(existsSync(join(ref, file))).toBe(false);

    git("checkout", "-qf", "p/s01");
    const red = await learnerRun();
    expect(red[0]!.status).toBe("fail");
    expect(red[0]!.failures[0]!.message).toContain("Count: 0");
    expect(red[0]!.screenshot).toMatch(/^data:image\/jpeg;base64,/);
  }, 600_000);
});
