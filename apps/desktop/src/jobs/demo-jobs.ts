// A simulated analysis for `pnpm dev` in a plain browser (no Rust, no Claude Code): the same
// JobManager and job files, on an in-memory host, with stages that take a few seconds and save
// sample results. It lets the import, live analysis and overview screens be built and checked.
import { analysisPaths, MemoryHost, type Job, type StageContext, type StageDefinition, type Summaries } from "@knyc/core";
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

function demoStages(host: MemoryHost) {
  const backend = createFakeImportBackend();
  return (job: Job, signal: AbortSignal): StageDefinition[] => {
    const paths = analysisPaths(job.cacheDir);
    const save = (path: string, value: unknown) => host.writeFile(path, JSON.stringify(value));
    const sample = backend.quickScan(job.input.source);
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
