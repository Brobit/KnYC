// The path stages (#61; design/02 ⑥–⑧), on the analysis job once the learner chose a path: the
// plan, the reference timeline, then the checks one step at a time (design/02 D5). Each step's
// checks are saved as soon as they are proven and `path.json` says which steps are ready, so the
// learner starts step 1 while the job prepares the next ones. Like the analysis stages, every
// result is saved: a resumed job skips what is already there.

import { AiClient } from "../ai/client.ts";
import { FileCache } from "../ai/cache.ts";
import { joinPath, type Host } from "../host/host.ts";
import { prepareChecks, type ChecksPreparation, type StepChecksResult } from "../pipeline/checks/index.ts";
import type { TestMapping } from "../pipeline/checks/existing.ts";
import { generatePlan, type PlanInput } from "../pipeline/plan.ts";
import { projectFacts } from "../pipeline/sources.ts";
import type { Summaries } from "../pipeline/summaries.ts";
import { buildTimeline, type Timeline } from "../pipeline/timeline.ts";
import { buildUnits, type Units } from "../pipeline/units.ts";
import { profileFor } from "../profiles/index.ts";
import type { Check } from "../schemas/check.ts";
import type { Job, PathChoice } from "../schemas/job.ts";
import { learningPath, type LearningPath } from "../schemas/learning-path.ts";
import { graphSchema, scanSchema, type Graph, type Scan } from "../sys/knyc-sys.ts";
import { analysisPaths, analysisStages, counting, readJson, type AnalysisDependencies } from "./analysis.ts";
import type { StageDefinition } from "./runner.ts";

export const PATH_STAGES = ["plan", "timeline", "checks"] as const;
export type PathStageId = (typeof PATH_STAGES)[number];

/** "backend-standard", "full-deep-setup": one folder per choice, so changing your mind keeps the other. */
export function pathIdFor(choice: PathChoice): string {
  return `${choice.track}-${choice.size}${choice.setupAsStep ? "-setup" : ""}`;
}

/** Where a path's results live, under the analysis cache. */
export function pathPaths(cacheDir: string, pathId: string) {
  const dir = joinPath(cacheDir, "paths", pathId);
  return {
    dir,
    /** The LearningPath; its steps' `prep` says which are ready. */
    path: joinPath(dir, "path.json"),
    timeline: joinPath(dir, "timeline.json"),
    /** The reference repository (R₀ … R_n as tags). */
    workDir: joinPath(dir, "reference"),
    /** Which of the project's tests prove which step. */
    testMapping: joinPath(dir, "test-mapping.json"),
    /** One file per prepared step: its checks and check files. */
    step: (stepId: string) => joinPath(dir, "steps", `${stepId}.json`),
  };
}

/** The job going on with a path: the path stages are added, or start over for another choice. */
export function withPathChoice(job: Job, choice: PathChoice): Job {
  const same = job.choice !== undefined && pathIdFor(job.choice) === pathIdFor(choice);
  const analysis = job.stages.filter((s) => !(PATH_STAGES as readonly string[]).includes(s.id));
  const path = PATH_STAGES.map((id) => (same ? job.stages.find((s) => s.id === id) : undefined) ?? { id, status: "pending" as const });
  return { ...job, choice, status: "running", reason: undefined, resumeAt: undefined, stages: [...analysis, ...path] };
}

/** A prepared step as saved on disk (Maps don't go through JSON). */
interface SavedStep {
  checks: Check[];
  files: Record<string, string>;
  report: StepChecksResult["report"];
}

/** The plan, timeline and checks steps; injectable for tests (they need a real build otherwise). */
export interface PathPipeline {
  plan(client: AiClient, input: PlanInput, planning: AnalysisDependencies["roles"]["planning"]): Promise<LearningPath>;
  timeline(path: LearningPath, graph: Graph, scan: Scan, units: Units, options: { host: Host; sourceRoot: string; workDir: string }): Promise<Timeline>;
  checks(
    path: LearningPath,
    timeline: Timeline,
    graph: Graph,
    scan: Scan,
    options: { host: Host; sourceRoot: string; client: AiClient; mapping?: TestMapping },
  ): Promise<ChecksPreparation>;
}

const realPipeline: PathPipeline = {
  plan: async (client, input, planning) => (await generatePlan(client, input, { planning })).path,
  timeline: (path, graph, scan, units, options) => buildTimeline(path, graph, scan, units, options),
  checks: (path, timeline, graph, scan, options) => prepareChecks(path, timeline, graph, scan, options),
};

/** Every stage of the job: the analysis, then the path once one is chosen. */
export function jobStages(job: Job, deps: AnalysisDependencies & { pipeline?: PathPipeline }): StageDefinition[] {
  return [...analysisStages(job, deps), ...pathStages(job, deps)];
}

export function pathStages(job: Job, deps: AnalysisDependencies & { pipeline?: PathPipeline }): StageDefinition[] {
  const choice = job.choice;
  if (!choice) return [];
  const { host } = deps;
  const pipeline = deps.pipeline ?? realPipeline;
  const analysis = analysisPaths(job.cacheDir);
  const paths = pathPaths(job.cacheDir, pathIdFor(choice));
  const save = (path: string, value: unknown) => host.writeFile(path, JSON.stringify(value, null, 2));
  const tryRead = <T>(path: string, parse: (raw: unknown) => T) => readJson(host, path).then(parse, () => undefined);
  const loadPath = () => tryRead(paths.path, (raw) => learningPath.parse(raw));
  const loadInputs = async () => {
    const [scan, graph] = await Promise.all([
      readJson(host, analysis.scan).then((raw) => scanSchema.parse(raw) as Scan),
      readJson(host, analysis.graph).then((raw) => graphSchema.parse(raw) as Graph),
    ]);
    return { scan, graph, units: buildUnits(graph) };
  };
  const clientFor = (context: Parameters<StageDefinition["run"]>[0]) =>
    new AiClient({
      providers: [counting(deps.provider(context.signal), context.aiCall)],
      roles: deps.roles,
      cache: new FileCache(host, analysis.aiCache),
    });
  const required = async () => {
    const path = await loadPath();
    if (!path) throw new Error("the path plan is missing; prepare the path again");
    return path;
  };

  return [
    {
      id: "plan",
      async run(context) {
        if (await loadPath()) return;
        const { scan, graph, units } = await loadInputs();
        const summaries = (await readJson(host, analysis.summaries)) as Summaries;
        const facts = projectFacts(job.input.name, scan, graph);
        const planned = await pipeline.plan(
          clientFor(context),
          { track: choice.track, size: choice.size, units, summaries, profile: profileFor(facts.frameworks), hasTests: scan.testRunners.length > 0 },
          deps.roles.planning,
        );
        await save(paths.path, learningPath.parse({ ...planned, id: pathIdFor(choice), setupAsStep: choice.setupAsStep, status: "preparing" }));
      },
    },
    {
      id: "timeline",
      async run() {
        if (await tryRead(paths.timeline, (raw) => raw as Timeline)) return;
        const path = await required();
        const { scan, graph, units } = await loadInputs();
        // An interrupted build starts over: the timeline needs an empty folder.
        await host.remove(paths.workDir);
        const timeline = await pipeline.timeline(path, graph, scan, units, { host, sourceRoot: analysis.sandbox, workDir: paths.workDir });
        const builds = new Map(timeline.steps.map((s) => [s.stepId, s]));
        await save(paths.path, {
          ...path,
          steps: path.steps.map((step) => {
            const commit = builds.get(step.id)?.commit;
            return { ...step, prep: "reference-ready", ...(commit ? { reference: { commit } } : {}) };
          }),
        });
        await save(paths.timeline, timeline);
      },
    },
    {
      id: "checks",
      async run(context) {
        let path = await required();
        const timeline = await tryRead(paths.timeline, (raw) => raw as Timeline);
        if (!timeline) throw new Error("the reference timeline is missing; prepare the path again");
        const total = path.steps.length;
        const ready = () => path.steps.filter(stepIsReady).length;
        context.progress(ready(), total);
        if (ready() === total) return;

        const { scan, graph } = await loadInputs();
        const saved = await tryRead(paths.testMapping, (raw) => raw as { byStep: [string, string[]][]; discarded: TestMapping["discarded"] });
        const preparation = await pipeline.checks(path, timeline, graph, scan, {
          host,
          sourceRoot: analysis.sandbox,
          client: clientFor(context),
          mapping: saved ? { byStep: new Map(saved.byStep), discarded: saved.discarded } : undefined,
        });
        if (!saved) await save(paths.testMapping, { byStep: [...preparation.mapping.byStep], discarded: preparation.mapping.discarded });

        // In order: step 1 first, so the learner can start; the others follow in the background.
        for (const step of path.steps) {
          if (stepIsReady(step)) continue;
          if (context.signal.aborted) return;
          const result = await preparation.forStep(step.id);
          const document: SavedStep = { checks: result.checks, files: Object.fromEntries(result.files), report: result.report };
          await save(paths.step(step.id), document);
          path = { ...path, steps: path.steps.map((s) => (s.id === step.id ? result.step : s)) };
          await save(paths.path, path);
          context.progress(ready(), total);
        }
        await save(paths.path, { ...path, status: "ready" });
      },
    },
  ];
}

/** The chosen path as prepared so far (the live view and, later, the workspace read it). */
export async function loadPathSoFar(host: Host, job: Job): Promise<LearningPath | undefined> {
  if (!job.choice) return undefined;
  try {
    return learningPath.parse(await readJson(host, pathPaths(job.cacheDir, pathIdFor(job.choice)).path));
  } catch {
    return undefined;
  }
}

/** A step the learner can open: its checks are proven (design/02 D5). */
export const stepIsReady = (step: LearningPath["steps"][number]) => step.prep === "checks-ready" || step.prep === "ready";
