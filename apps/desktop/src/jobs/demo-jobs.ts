// A simulated analysis for `pnpm dev` in a plain browser (no Rust, no Claude Code): the same
// JobManager and job files, on an in-memory host, with stages that take a few seconds and save
// sample results. It lets the import, live analysis, overview and path screens be built and checked.
import {
  analysisPaths,
  learningPath,
  MemoryHost,
  pathIdFor,
  pathPaths,
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
        if (!signal.aborted) await save(path!.path, { ...planned, steps: planned.steps.map((s) => ({ ...s, prep: "reference-ready" })) });
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

export function createDemoJobManager(): JobManager {
  const host = new MemoryHost();
  let n = 0;
  return new JobManager({
    host,
    dataDir: async () => "/demo",
    roles: () => defaultSettings().roles,
    provider: () => {
      throw new Error("the demo has no AI");
    },
    stages: demoStages(host),
    newId: () => `demo-${++n}`,
  });
}
