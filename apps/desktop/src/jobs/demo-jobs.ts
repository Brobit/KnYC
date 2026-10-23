// A simulated analysis for `pnpm dev` in a plain browser (no Rust, no Claude Code): the same
// JobManager and job files, on an in-memory host, with stages that take a few seconds and save
// sample results. It lets the import, live analysis, overview, path and lesson screens be built and
// checked: the reference answers git with a sample setup, and lessons come from a pretend model.
import {
  analysisPaths,
  learningPath,
  MemoryHost,
  pathIdFor,
  pathPaths,
  type AiProvider,
  type Graph,
  type Job,
  type LearningPath,
  type PathChoice,
  type StageContext,
  type StageDefinition,
  type Summaries,
} from "@knyc/core";
import { defaultSettings } from "@knyc/core/schemas";
import { createFakeImportBackend } from "@/import/import-backend";
import { JobManager } from "./job-manager";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()));
  });

function demoSummaries(paths: string[], name: string): Summaries {
  const role = (path: string) => (path.includes("routes") ? "HTTP routes" : path.includes("store") ? "in-memory storage" : path.includes("validation") ? "input validation" : path.endsWith("app.ts") ? "app factory" : path.endsWith("server.ts") ? "entry point" : "shared helpers");
  return {
    version: 1,
    files: paths.map((path) => ({ path, role: role(path), summary: `${path} holds the ${role(path)} of the app.`, keySymbols: [] })),
    modules: [
      { module: "src", summary: "App factory, server entry point, configuration and errors.", files: paths.filter((p) => !p.includes("/notes/")) },
      { module: "src/notes", summary: "Notes feature: model, storage, validation and routes.", files: paths.filter((p) => p.includes("/notes/")) },
    ],
    project: {
      name,
      purpose: "A small REST API to create, list, update and delete notes, kept in memory.",
      architecture: "An Express app wires the notes router; routes validate input and call an in-memory store.",
      entryPoints: ["src/server.ts"],
      keyConcepts: ["Express routing", "validation", "error handling"],
    },
  };
}

/** One step per source file, in build order (layers): enough to see the path being prepared. */
function demoPath(graph: Graph, choice: PathChoice): LearningPath {
  const source = new Set(graph.files.filter((f) => !f.test).map((f) => f.path));
  const files = graph.layers.flat().filter((path) => source.has(path));
  const name = (path: string) => path.split("/").pop()!.replace(/.ts$/, "");
  const steps = files.map((path, index) => ({
    id: `s${String(index + 1).padStart(2, "0")}`,
    index,
    title: `Write ${name(path)}`,
    goal: `${path} does its job and its check passes.`,
    concepts: [],
    introduces: [{ unit: path, kind: "file" as const, change: "add" as const }],
    dependsOn: [],
    checkIds: [],
    estimatedMinutes: 25,
    prep: "planned" as const,
  }));
  const half = Math.ceil(steps.length / 2);
  return learningPath.parse({
    schemaVersion: 1,
    id: pathIdFor(choice),
    trackId: choice.track,
    size: choice.size,
    setupAsStep: choice.setupAsStep,
    generatedWith: { planning: { providerId: "demo", model: "demo" }, at: new Date().toISOString() },
    status: "preparing",
    milestones: [
      { id: "m1", title: "Foundations", summary: "Configuration, errors and the note model.", stepIds: steps.slice(0, half).map((s) => s.id) },
      { id: "m2", title: "The notes API", summary: "Storage, validation, routes and the server.", stepIds: steps.slice(half).map((s) => s.id) },
    ],
    steps,
  });
}

function demoStages(host: MemoryHost) {
  const backend = createFakeImportBackend();
  return (job: Job, signal: AbortSignal): StageDefinition[] => {
    const paths = analysisPaths(job.cacheDir);
    const save = (path: string, value: unknown) => host.writeFile(path, JSON.stringify(value));
    const sample = backend.quickScan(job.input.source);
    const path = job.choice && pathPaths(job.cacheDir, pathIdFor(job.choice));
    const readPath = async () => learningPath.parse(JSON.parse(await host.readFile(path!.path)));
    const steps: Record<string, (context: StageContext) => Promise<void>> = {
      intake: () => wait(700, signal),
      scan: async () => {
        await wait(600, signal);
        await save(paths.scan, (await sample).scan);
      },
      graph: async () => {
        await wait(900, signal);
        await save(paths.graph, (await sample).graph);
      },
      summaries: async (context) => {
        const files = (await sample).graph.files.filter((f) => !f.test).map((f) => f.path);
        for (let done = 0; done <= files.length && !signal.aborted; done++) {
          context.progress(done, files.length);
          if (done % 3 === 0) context.aiCall();
          await wait(450, signal);
        }
        if (!signal.aborted) await save(paths.summaries, demoSummaries(files, job.input.name));
      },
      plan: async (context) => {
        context.aiCall();
        await wait(1500, signal);
        if (!signal.aborted) await save(path!.path, demoPath((await sample).graph, job.choice!));
      },
      timeline: async () => {
        await wait(1500, signal);
        const planned = await readPath();
        if (signal.aborted) return;
        await save(path!.timeline, {
          pathId: planned.id,
          workDir: path!.workDir,
          steps: planned.steps.map((s) => ({ stepId: s.id, ok: true, tag: `${planned.id}/${s.id}`, durationMs: 1 })),
          finalMatchesOriginal: true,
          setupFixes: [],
        });
        await save(path!.path, { ...planned, steps: planned.steps.map((s) => ({ ...s, prep: "reference-ready" })) });
      },
      // A few seconds per step, so step 1 is ready long before the others.
      checks: async (context) => {
        let current = await readPath();
        const total = current.steps.length;
        for (const [i, step] of current.steps.entries()) {
          context.progress(i, total);
          if (step.prep === "checks-ready") continue;
          context.aiCall();
          await wait(2500, signal);
          if (signal.aborted) return;
          const checkIds = [`chk-${step.id}-1`];
          const file = step.introduces[0]!.unit;
          const checkFile = `.knyc-checks/${step.id}.test.mjs`;
          await save(path!.step(step.id), {
            checks: [
              {
                schemaVersion: 1,
                id: checkIds[0],
                stepId: step.id,
                label: `${file} exists and holds its code`,
                origin: "generated",
                timeoutMs: 60_000,
                spec: { kind: "test", root: ".", runner: "other", command: `node --test ${checkFile}`, filter: [], files: [checkFile] },
              },
            ],
            files: { [checkFile]: `${DEMO_REQUIRES}${file}\n` },
            report: { stepId: step.id, strength: "strong", existing: 0, generated: 1, aiCalls: 1, notes: [] },
          });
          current = { ...current, steps: current.steps.map((s) => (s.id === step.id ? { ...s, prep: "checks-ready", checkIds, checkStrength: "strong" } : s)) };
          await save(path!.path, current);
        }
        context.progress(total, total);
        await save(path!.path, { ...current, status: "ready" });
      },
    };
    return job.stages.map(({ id }) => ({ id, run: (context) => steps[id]!(context) }));
  };
}

/** The first line of a demo check file: the check passes once this file has code (check-backend.ts). */
export const DEMO_REQUIRES = "// knyc-demo requires ";

/** The setup of the sample project, as the reference timeline's R₀ would hold it. */
const DEMO_SETUP: Record<string, string> = {
  "package.json": '{\n  "name": "express-notes",\n  "type": "module",\n  "scripts": { "build": "tsc", "start": "node dist/server.js" },\n  "dependencies": { "express": "^4.21.2" }\n}\n',
  "tsconfig.json": '{\n  "compilerOptions": { "outDir": "dist", "rootDir": "src", "strict": true, "module": "nodenext" }\n}\n',
  ".gitignore": "node_modules/\ndist/\n",
};

/** git as the reference repository would answer the learning screens (no working copy is touched). */
function demoGit(_cwd: string, args: string[]): string {
  if (args[0] === "ls-tree") return Object.keys(DEMO_SETUP).join("\n");
  if (args[0] === "show") return DEMO_SETUP[args[1]!.split(":").slice(1).join(":")] ?? "";
  if (args[0] === "diff") return `+// what the original adds between ${args[1]} and ${args[2]}\n`;
  return "";
}

/** Answers lesson requests like the model would, from the step in the prompt. */
const demoProvider: AiProvider = {
  id: "claude-cli",
  async complete(request) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const step = /# This step: (\S+) "([^"]+)"/.exec(request.prompt);
    const files = /\nFiles: (.+)\n/.exec(request.prompt)?.[1] ?? "the step's file";
    const title = step?.[2] ?? "this step";
    return {
      json: {
        explanation: `## ${title}\n\nIn this step you create **${files}**. It is a small, self-contained piece of the notes API, and the next steps build on it.\n\n- Start from the goal on the right: it says what must work when you are done.\n- Write the file from scratch; the names the checks use are the ones in the goal.\n- Run the checks with \`Ctrl+Enter\` as often as you like: red first, then green.\n\nThis is the browser preview: the lesson is a sample, and the check passes as soon as \`${files}\` has some code.`,
        architectureNote: `${files} is used by the files of the next steps.`,
      },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: null,
      durationMs: 1200,
    };
  },
};

export function createDemoJobManager(): JobManager {
  const host = new MemoryHost({ git: demoGit });
  let n = 0;
  return new JobManager({
    host,
    dataDir: async () => "/demo",
    roles: () => defaultSettings().roles,
    provider: () => demoProvider,
    stages: demoStages(host),
    newId: () => `demo-${++n}`,
  });
}
