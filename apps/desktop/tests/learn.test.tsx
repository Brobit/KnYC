import { configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import {
  analysisPaths,
  knycPaths,
  learningPath,
  MemoryHost,
  pathIdFor,
  pathPaths,
  type AiProvider,
  type Job,
  type LearningPath,
  type StageContext,
  type StageDefinition,
  type Summaries,
} from "@knyc/core";
import { defaultSettings } from "@knyc/core/schemas";
import { AnalysisScreen } from "@/analysis/AnalysisScreen";
import { CommandsProvider } from "@/commands/commands";
import { createFakeImportBackend } from "@/import/import-backend";
import { DEMO_REQUIRES } from "@/jobs/demo-jobs";
import { JobManager } from "@/jobs/job-manager";
import { JobsProvider } from "@/jobs/jobs-context";
import { fakeCheckRun, fakeReadForAi, type ReadForAi } from "@/learn/learn-backend";
import { LearningProvider, useLearning } from "@/learn/learning-context";
import { LessonPanel } from "@/learn/LessonPanel";
import { PathPanel } from "@/learn/PathPanel";
import { inline, parseBlocks } from "@/learn/Markdown";
import { createFakeWorkspaceFs } from "@/lib/fake-workspace-fs";
import type { WorkspaceFs } from "@/lib/workspace-fs";
import { SettingsProvider } from "@/lib/settings";
import { useWorkspace, WorkspaceProvider } from "@/workspace/workspace-context";

// Check runs go through a pretend install, build and run: slower than the default 1 s under load.
configure({ asyncUtilTimeout: 5000 });

describe("Markdown", () => {
  it("reads headings, paragraphs, lists and code blocks", () => {
    const blocks = parseBlocks("## Config\n\nRead the port\nfrom the env.\n\n- one\n- two\n  still two\n1. first\n\n```ts\nconst a = 1;\n```");
    expect(blocks).toEqual([
      { kind: "heading", level: 2, text: "Config" },
      { kind: "paragraph", text: "Read the port from the env." },
      { kind: "list", ordered: false, items: ["one", "two still two"] },
      { kind: "list", ordered: true, items: ["first"] },
      { kind: "code", text: "const a = 1;" },
    ]);
  });

  it("keeps markup as text and formats code, bold and italic", () => {
    const parts = inline("Use `loadConfig` and **never** <b>trust</b> *input*");
    expect(parts[0]).toBe("Use ");
    expect(parts).toContain(" and ");
    expect(parts).toContain(" <b>trust</b> ");
    expect(parts).toHaveLength(6);
  });
});

const INPUT = { source: "/home/you/code/express-notes", sourceHash: "blake3:0123456789abcdef", name: "express-notes", workspace: "/home/you/KnYC/express-notes" };
const SETUP: Record<string, string> = { "package.json": '{"name":"express-notes"}', "tsconfig.json": "{}" };

/** A two-step path: the first step writes src/config.ts. */
function samplePath(job: Job): LearningPath {
  const step = (n: number, title: string, unit: string) => ({ id: `s0${n}`, index: n - 1, title, goal: `Write ${unit}.`, concepts: ["configuration"], introduces: [{ unit, kind: "file" as const, change: "add" as const }], estimatedMinutes: 25 });
  return learningPath.parse({
    schemaVersion: 1,
    id: pathIdFor(job.choice!),
    trackId: "backend",
    size: "standard",
    setupAsStep: false,
    generatedWith: { planning: { providerId: "claude-cli", model: "sonnet" }, at: "2026-10-23T08:00:00.000Z" },
    status: "preparing",
    milestones: [{ id: "m1", title: "Foundations", summary: "s", stepIds: ["s01", "s02"] }],
    steps: [step(1, "Configuration", "src/config.ts"), step(2, "Errors", "src/errors.ts")],
  });
}

/** The prompts of explanations and chat answers, to see what was sent. */
const prompts: string[] = [];

const lessonModel: AiProvider = {
  id: "claude-cli",
  complete: async (request) => ({
    json: /\nWrite Hint (\d)/.test(request.prompt)
      ? { text: `Hint text ${/\nWrite Hint (\d)/.exec(request.prompt)![1]}: look at what src/server.ts imports.` }
      : (prompts.push(request.prompt), /# The failing check/.test(request.prompt))
        ? { text: "The file is empty, so the check has **nothing to run**." }
        : /# The learner asks/.test(request.prompt)
          ? { text: "Because the server calls it at start-up." }
          : { explanation: "## Configuration\n\nExport `loadConfig` from **src/config.ts**: it reads the port from the environment, with 3000 when it is missing.", architectureNote: "Used by src/server.ts." },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: null,
    durationMs: 1,
  }),
};

/** Instant stages: the sample analysis, a two-step path, a timeline and one demo check per step. */
function manager() {
  const host = new MemoryHost({
    git: (_cwd, args) => {
      if (args[0] === "ls-tree") return Object.keys(SETUP).join("\n");
      if (args[0] === "diff") return args[1] === "--name-only" ? (args[3]!.endsWith("/s02") ? "src/errors.ts\n" : "src/config.ts\n") : "+export function loadConfig() {}";
      if (args[0] !== "show") return "";
      const [tag, file] = args[1]!.split(":") as [string, string];
      if (SETUP[file] !== undefined) return SETUP[file];
      if (file === "src/errors.ts" && tag.endsWith("/s02")) return "export class NotFound extends Error {}\n";
      if (file === "src/config.ts" && tag.endsWith("/s01")) return "export function loadConfig() {\n  return { port: 3000 };\n}\n";
      throw new Error(`fatal: path '${file}' does not exist in '${tag}'`);
    },
  });
  const backend = createFakeImportBackend();
  return new JobManager({
    host,
    dataDir: async () => "/data",
    roles: () => defaultSettings().roles,
    provider: () => lessonModel,
    newId: () => "job-1",
    stages: (job): StageDefinition[] => {
      const paths = analysisPaths(job.cacheDir);
      const path = job.choice && pathPaths(job.cacheDir, pathIdFor(job.choice));
      const sample = backend.quickScan(job.input.source);
      const save = (file: string, value: unknown) => host.writeFile(file, JSON.stringify(value));
      const steps: Record<string, (context: StageContext) => Promise<void>> = {
        intake: async () => {},
        scan: async () => save(paths.scan, (await sample).scan),
        graph: async () => save(paths.graph, (await sample).graph),
        summaries: async () => {
          const summaries: Summaries = { version: 1, files: [], modules: [], project: { name: "express-notes", purpose: "Notes API.", architecture: "Routes and a store.", entryPoints: [], keyConcepts: [] } };
          await save(paths.summaries, summaries);
        },
        plan: async () => save(path!.path, samplePath(job)),
        timeline: async () =>
          save(path!.timeline, { pathId: "backend-standard", workDir: path!.workDir, steps: ["s01", "s02"].map((id) => ({ stepId: id, ok: true, tag: `backend-standard/${id}`, durationMs: 1 })), finalMatchesOriginal: true, setupFixes: [] }),
        checks: async () => {
          const planned = samplePath(job);
          for (const step of planned.steps) {
            const file = `.knyc-checks/${step.id}.test.mjs`;
            await save(path!.step(step.id), {
              checks: [{ schemaVersion: 1, id: `chk-${step.id}-1`, stepId: step.id, label: `${step.introduces[0]!.unit} has its code`, origin: "generated", timeoutMs: 1000, spec: { kind: "test", root: ".", runner: "other", command: `node --test ${file}`, filter: [], files: [file] } }],
              files: { [file]: `${DEMO_REQUIRES}${step.introduces[0]!.unit}\n` },
              report: { stepId: step.id, strength: "strong", existing: 0, generated: 1, aiCalls: 0, notes: [] },
            });
          }
          await save(path!.path, { ...planned, status: "ready", steps: planned.steps.map((s) => ({ ...s, prep: "checks-ready", checkIds: [`chk-${s.id}-1`] })) });
        },
      };
      return job.stages.map(({ id }) => ({ id, run: (context) => steps[id]!(context) }));
    },
  });
}

/** Stands in for the Rust secret guard: a secret-looking line becomes "[guarded]". */
function guarded(fs: WorkspaceFs): ReadForAi {
  const read = fakeReadForAi(fs);
  const hide = (text: string) => text.replace(/.*hunter22.*/g, "[guarded]");
  return async (paths, texts) => {
    const out = await read(paths, texts);
    return { files: new Map([...out.files].map(([p, c]) => [p, c === null ? null : hide(c)])), texts: out.texts.map(hide) };
  };
}

/** Opens a workspace again, like Home's recent workspaces after a restart. */
function Reopen({ root }: { root: string }) {
  const { openRecent } = useWorkspace();
  useEffect(() => void openRecent(root), [openRecent, root]);
  return null;
}

function StartButton({ job }: { job: Job }) {
  const { startLearning } = useLearning();
  return <button onClick={() => void startLearning(job)}>start for test</button>;
}

describe("the learning workspace", () => {
  it("starts step 1 on the setup, writes the lesson once, and turns the checks from red to green", async () => {
    const jobs = manager();
    const job = await jobs.startAnalysis(INPUT);
    await jobs.whenSettled(job.id);
    await jobs.choosePath(job.id, { track: "backend", size: "standard", setupAsStep: false });
    await jobs.whenSettled(job.id);
    const fs = createFakeWorkspaceFs({});
    const user = userEvent.setup();
    let opened = false;
    const snapshots: string[] = [];
    const snapshot = async (message: string) => (snapshots.push(message), `snap00${snapshots.length}`);
    const { unmount } = render(
      <SettingsProvider initial={defaultSettings()}>
        <CommandsProvider>
          <JobsProvider manager={jobs}>
            <WorkspaceProvider fs={fs}>
              <LearningProvider runCheck={fakeCheckRun(fs)} readForAi={guarded(fs)} snapshot={snapshot}>
                <AnalysisScreen jobId={job.id} onHome={() => {}} onOverview={() => {}} onChoosePath={() => {}} onStartLearning={async () => void (opened = true)} />
                <StartButton job={jobs.getSnapshot()[0]!} />
                <LessonPanel empty={<p>no lesson</p>} />
                <PathPanel empty={<p>no path</p>} />
              </LearningProvider>
            </WorkspaceProvider>
          </JobsProvider>
        </CommandsProvider>
      </SettingsProvider>,
    );

    // The live view's button hands over to the app.
    await user.click(await screen.findByRole("button", { name: /Start step 1/ }));
    expect(opened).toBe(true);
    expect(screen.getByText("no lesson")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "start for test" }));
    await screen.findByRole("region", { name: "Lesson" });
    const panel = document.body;
    expect(within(panel).getByRole("heading", { name: "Configuration", level: 2 })).toBeInTheDocument();
    expect(within(panel).getByText("Step 1 · Milestone 1: Foundations")).toBeInTheDocument();
    expect(within(panel).getByText("Write src/config.ts.")).toBeInTheDocument();
    expect(await within(panel).findByText("loadConfig")).toBeInTheDocument();
    expect(within(panel).getByText("Where this fits: Used by src/server.ts.")).toBeInTheDocument();

    // R₀ and .knyc/ are in the workspace; the lesson is kept for next time.
    expect(await fs.read("package.json")).toBe('{"name":"express-notes"}');
    await waitFor(async () => expect(await fs.exists(knycPaths("backend-standard").lesson("s01"))).toBe(true));
    expect(await fs.exists(knycPaths("backend-standard").check("chk-s02-1"))).toBe(true);

    // Red: the file isn't written yet.
    await user.click(within(panel).getByRole("button", { name: /Run checks/ }));
    expect(await within(panel).findByRole("listitem", { name: "src/config.ts has its code: fails" })).toBeInTheDocument();
    expect(within(panel).getByText(/src\/config.ts is missing or empty/)).toBeInTheDocument();

    // Explain this failure, then a question: both go through the secret guard and stay in the step chat.
    await fs.createDir("src");
    await fs.write("src/config.ts", 'const db = "postgres://admin:hunter22@db/app";\n');
    await user.click(within(panel).getByRole("button", { name: "Explain this failure" }));
    const chat = await within(panel).findByRole("list", { name: "Questions about this step" });
    expect(await within(chat).findByText("nothing to run")).toBeInTheDocument();
    expect(within(chat).getByRole("listitem", { name: "You" })).toHaveTextContent("Why does “src/config.ts has its code” fail?");
    expect(prompts[prompts.length - 1]).toContain("[guarded]");
    expect(prompts[prompts.length - 1]).not.toContain("hunter22");
    await user.type(within(panel).getByRole("textbox", { name: "Ask about this step" }), "Why a function?{Enter}");
    expect(await within(chat).findByText("Because the server calls it at start-up.")).toBeInTheDocument();
    expect(prompts[prompts.length - 1]).toContain("# The learner asks\nWhy a function?");
    const saved = JSON.parse(await fs.read(knycPaths("backend-standard").lesson("s01")));
    expect(saved.chat.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    await fs.write("src/config.ts", "");

    // Green once the learner writes it.
    await fs.write("src/config.ts", "export const loadConfig = () => ({ port: 3000 });\n");
    await user.click(within(panel).getByRole("button", { name: /Run checks/ }));
    expect(await within(panel).findByRole("listitem", { name: "src/config.ts has its code: passes" })).toBeInTheDocument();
    expect(within(panel).getByRole("status")).toHaveTextContent("Every check passes: step complete.");
    // Step complete: the code is saved in a snapshot, once.
    await waitFor(() => expect(within(panel).getByRole("status")).toHaveTextContent("snapshot snap001 saved"));
    expect(snapshots).toEqual(["s01 passed: Configuration"]);

    const progress = JSON.parse(await fs.read(".knyc/progress.json"));
    expect(progress.paths["backend-standard"].steps.s01).toMatchObject({ status: "passed", attempts: 2 });
    expect((await fs.read(knycPaths("backend-standard").runs("s01"))).trim().split("\n")).toHaveLength(2);
    // The check file was only there while the checks ran.
    expect(await fs.exists(".knyc-checks")).toBe(false);

    // The help ladder: only the next hint can be taken; each one is shown, kept and counted.
    expect(within(panel).getByRole("button", { name: "Hint 2" })).toBeDisabled();
    await user.click(within(panel).getByRole("button", { name: "Hint 1" }));
    expect(await within(panel).findByRole("listitem", { name: "Hint 1" })).toHaveTextContent("Hint text 1: look at what src/server.ts imports.");
    await user.click(within(panel).getByRole("button", { name: "Hint 2" }));
    await within(panel).findByRole("listitem", { name: "Hint 2" });
    await user.click(within(panel).getByRole("button", { name: "Hint 3" }));
    await within(panel).findByRole("listitem", { name: "Hint 3" });
    const lesson = JSON.parse(await fs.read(knycPaths("backend-standard").lesson("s01")));
    expect(lesson.hints.map((h: { level: number }) => h.level)).toEqual([1, 2, 3]);

    // The last rung: confirmed, counted, then the original's change for the step.
    await user.click(within(panel).getByRole("button", { name: /Reveal original/ }));
    await user.click(await screen.findByRole("button", { name: "Reveal" }));
    const dialog = await screen.findByRole("dialog", { name: "The original for this step" });
    expect(within(dialog).getByText("Revealed: counted in your stats.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "src/config.ts" })).toHaveAttribute("aria-current", "true");
    expect(within(dialog).getByText("added by this step")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("switch", { name: "Compare with my code" }));
    expect(within(dialog).getByText("Your code → the original after this step")).toBeInTheDocument();

    const after = JSON.parse(await fs.read(".knyc/progress.json"));
    expect(after.paths["backend-standard"].steps.s01).toMatchObject({ hintsUsed: [1, 2, 3], revealed: true, attempts: 2, snapshot: "snap001" });

    // Next step, then skip it: the learner's code is saved first, the original's is applied.
    await user.keyboard("{Escape}");
    await user.click(within(panel).getByRole("button", { name: /Next step/ }));
    expect(await within(panel).findByRole("heading", { name: "Errors", level: 2 })).toBeInTheDocument();
    expect(within(panel).getByRole("listitem", { name: "Configuration: passed" })).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: /Skip this step/ }));
    await user.click(await screen.findByRole("button", { name: "Skip" }));
    expect(await within(panel).findByText("Path complete: every step is done.")).toBeInTheDocument();
    expect(snapshots[1]).toBe("before skipping s02");
    expect(await fs.read("src/errors.ts")).toBe("export class NotFound extends Error {}\n");
    const done = JSON.parse(await fs.read(".knyc/progress.json")).paths["backend-standard"];
    expect(done.steps.s02.status).toBe("skipped");
    expect(done.completedAt).toBeDefined();

    // After a restart, the workspace reads the same progress: the skipped step stays marked.
    unmount();
    render(
      <SettingsProvider initial={defaultSettings()}>
        <WorkspaceProvider fs={fs}>
          <LearningProvider runCheck={fakeCheckRun(fs)} snapshot={snapshot}>
            <Reopen root={INPUT.workspace} />
            <PathPanel empty={<p>no path</p>} />
          </LearningProvider>
        </WorkspaceProvider>
      </SettingsProvider>,
    );
    expect(await screen.findByText("Path complete: every step is done.")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Configuration: passed" })).toHaveAttribute("title", "Snapshot snap001");
  }, 30_000); // The whole flow, from Start step 1 to the reveal.
});
