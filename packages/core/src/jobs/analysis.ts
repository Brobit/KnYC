// The analysis job (#57; design/02 ①–⑤): intake, scan, code graph and summaries, everything the
// project overview needs. Each stage saves its result in `cache/<hash>/` (design/03), so the job
// can stop anywhere (limit, cancel, the app closing) and go on later. The path stages (plan,
// timeline, checks) come with the path choice (#61), on the same runner.
//
// Intake comes first and every later stage reads the sandbox only: after a restart the source
// folder may no longer be readable (the app forgets picked folders).

import { AiClient } from "../ai/client.ts";
import { FileCache } from "../ai/cache.ts";
import type { AiProvider, ProviderRequest } from "../ai/types.ts";
import { joinPath, type Host } from "../host/host.ts";
import { loadSourceFiles, projectFacts } from "../pipeline/sources.ts";
import { summarize, type Summaries } from "../pipeline/summaries.ts";
import type { AnalysisInput, Job } from "../schemas/job.ts";
import type { Settings } from "../schemas/settings.ts";
import { graphProject, graphSchema, intakeProject, scanProject, scanSchema, type Graph, type Scan } from "../sys/knyc-sys.ts";
import type { StageDefinition } from "./runner.ts";

export const ANALYSIS_STAGES = ["intake", "scan", "graph", "summaries"] as const;
export type AnalysisStageId = (typeof ANALYSIS_STAGES)[number];

/** `<data>/cache/<first 16 hex of the source hash>`, as the CLI does. */
export function cacheDirFor(dataDir: string, sourceHash: string): string {
  return joinPath(dataDir, "cache", sourceHash.replace(/^blake3:/, "").slice(0, 16));
}

/** Where each stage's result lives. */
export function analysisPaths(cacheDir: string) {
  return {
    sandbox: joinPath(cacheDir, "sandbox"),
    scan: joinPath(cacheDir, "scan.json"),
    graph: joinPath(cacheDir, "graph.json"),
    summaries: joinPath(cacheDir, "summaries.json"),
    /** Per-file summaries, so a paused summary stage goes on where it stopped. */
    summaryCache: joinPath(cacheDir, "summaries"),
    /** Every AI answer, by request. */
    aiCache: joinPath(cacheDir, "ai"),
  };
}

export function newAnalysisJob(input: AnalysisInput, options: { id: string; dataDir: string; now?: Date }): Job {
  const at = (options.now ?? new Date()).toISOString();
  return {
    schemaVersion: 1,
    id: options.id,
    kind: "analysis",
    createdAt: at,
    updatedAt: at,
    status: "running",
    input,
    cacheDir: cacheDirFor(options.dataDir, input.sourceHash),
    stages: ANALYSIS_STAGES.map((id) => ({ id, status: "pending" as const })),
    aiCalls: 0,
  };
}

/** Counts calls as they are made, including those of a stage that stops halfway. */
export function counting(provider: AiProvider, onCall: () => void): AiProvider {
  return {
    id: provider.id,
    async complete(request: ProviderRequest) {
      const response = await provider.complete(request);
      onCall();
      return response;
    },
  };
}

export interface AnalysisDependencies {
  host: Host;
  /** The AI provider for this run; it should stop its calls when `signal` aborts. */
  provider: (signal: AbortSignal) => AiProvider;
  /** settings.roles at the time the job runs. */
  roles: Settings["roles"];
}

export const readJson = async (host: Host, path: string) => JSON.parse(await host.readFile(path)) as unknown;

export function analysisStages(job: Job, deps: AnalysisDependencies): StageDefinition[] {
  const { host } = deps;
  const paths = analysisPaths(job.cacheDir);
  const save = (path: string, value: unknown) => host.writeFile(path, JSON.stringify(value));
  const loadScan = async () => scanSchema.parse(await readJson(host, paths.scan)) as Scan;
  const loadGraph = async () => graphSchema.parse(await readJson(host, paths.graph)) as Graph;

  return [
    {
      id: "intake",
      async run() {
        // A copy interrupted halfway is started over: intake needs an empty sandbox.
        await host.remove(paths.sandbox);
        await intakeProject(host, job.input.source, paths.sandbox);
      },
    },
    {
      id: "scan",
      run: async () => save(paths.scan, await scanProject(host, paths.sandbox)),
    },
    {
      id: "graph",
      run: async () => save(paths.graph, await graphProject(host, paths.sandbox)),
    },
    {
      id: "summaries",
      async run(context) {
        const [scan, graph] = await Promise.all([loadScan(), loadGraph()]);
        const files = await loadSourceFiles(host, paths.sandbox, scan, graph);
        if (files.length === 0) throw new Error("no source code found to learn from");
        const role = deps.roles.summaries;
        const client = new AiClient({
          providers: [counting(deps.provider(context.signal), context.aiCall)],
          roles: deps.roles,
          cache: new FileCache(host, paths.aiCache),
        });
        const { summaries } = await summarize(client, files, projectFacts(job.input.name, scan, graph), {
          cache: new FileCache(host, paths.summaryCache),
          cacheTag: `${role.providerId}:${role.model}`,
          onProgress: context.progress,
        });
        await save(paths.summaries, summaries);
      },
    },
  ];
}

export interface AnalysisResult {
  scan: Scan;
  graph: Graph;
  summaries: Summaries;
}

/** What the finished stages saved so far (the live analysis view shows them as they come). */
export async function loadAnalysisSoFar(host: Host, cacheDir: string): Promise<Partial<AnalysisResult>> {
  const paths = analysisPaths(cacheDir);
  const read = async <T>(path: string, parse: (raw: unknown) => T) => {
    try {
      return parse(await readJson(host, path));
    } catch {
      return undefined;
    }
  };
  const [scan, graph, summaries] = await Promise.all([
    read(paths.scan, (raw) => scanSchema.parse(raw) as Scan),
    read(paths.graph, (raw) => graphSchema.parse(raw) as Graph),
    read(paths.summaries, (raw) => raw as Summaries),
  ]);
  return { scan, graph, summaries };
}

/** The results of a finished analysis (the project overview reads them). */
export async function loadAnalysis(host: Host, cacheDir: string): Promise<AnalysisResult> {
  const paths = analysisPaths(cacheDir);
  const [scan, graph, summaries] = await Promise.all([
    readJson(host, paths.scan).then((raw) => scanSchema.parse(raw) as Scan),
    readJson(host, paths.graph).then((raw) => graphSchema.parse(raw) as Graph),
    readJson(host, paths.summaries).then((raw) => raw as Summaries),
  ]);
  return { scan, graph, summaries };
}
