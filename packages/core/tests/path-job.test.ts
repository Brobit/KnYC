import { describe, expect, it } from "vitest";
import graphFixture from "./fixtures/graphs/express-notes.json";
import planFixture from "./fixtures/plans/express-notes.standard.json";
import summariesFixture from "./fixtures/summaries/express-notes.json";
import {
  AiError,
  analysisPaths,
  jobStages,
  learningPath,
  loadPathSoFar,
  MemoryHost,
  newAnalysisJob,
  pathIdFor,
  pathPaths,
  runJob,
  withPathChoice,
  type Job,
  type PathChoice,
  type PathPipeline,
  type StepChecksResult,
} from "../src/index.ts";

const SCAN = {
  root: "/data/cache/abc/sandbox",
  hash: "blake3:abc",
  languages: [{ id: "typescript", files: 8, loc: 200 }],
  frameworks: [],
  testRunners: [],
  packages: [],
  commands: [],
  toolchains: [],
  files: [],
  excluded: [],
  secretLines: [],
};
const CHOICE: PathChoice = { track: "backend", size: "standard", setupAsStep: false };
const roles = {
  summaries: { providerId: "claude-cli", model: "haiku" },
  planning: { providerId: "claude-cli", model: "sonnet" },
  lessons: { providerId: "claude-cli", model: "sonnet" },
};
const PLAN = learningPath.parse(planFixture);
const STEPS = PLAN.steps.map((s) => s.id);

/** An analysed project (scan, graph, summaries saved) whose learner just chose a path. */
async function analysedJob(host: MemoryHost): Promise<Job> {
  const job = newAnalysisJob({ source: "/src/notes", sourceHash: "blake3:abcdef0123456789", name: "notes" }, { id: "job-1", dataDir: "/data" });
  const paths = analysisPaths(job.cacheDir);
  await host.writeFile(paths.scan, JSON.stringify(SCAN));
  await host.writeFile(paths.graph, JSON.stringify(graphFixture));
  await host.writeFile(paths.summaries, JSON.stringify(summariesFixture));
  return withPathChoice({ ...job, status: "done", stages: job.stages.map((s) => ({ ...s, status: "done" as const })) }, CHOICE);
}

/** Plan and timeline from fixtures; each step's checks wait for `gate(stepId)` when there is one. */
function fakePipeline(options: { gate?: (stepId: string) => Promise<void> | undefined } = {}) {
  const calls = { plan: 0, timeline: 0, steps: [] as string[] };
  const pipeline: PathPipeline = {
    plan: async () => (calls.plan++, PLAN),
    timeline: async (path, _graph, _scan, _units, { workDir }) => {
      calls.timeline++;
      return {
        pathId: path.id,
        workDir,
        steps: path.steps.map((s, i) => ({ stepId: s.id, ok: true, tag: `${path.id}/${s.id}`, commit: `c${i}`, durationMs: 1 })),
        finalMatchesOriginal: true,
        setupFixes: [],
      };
    },
    checks: async (path) => ({
      mapping: { byStep: new Map(), discarded: [] },
      async forStep(stepId): Promise<StepChecksResult> {
        calls.steps.push(stepId);
        await options.gate?.(stepId);
        const step = path.steps.find((s) => s.id === stepId)!;
        const check = { schemaVersion: 1 as const, id: `chk-${stepId}-1`, stepId, label: "works", origin: "generated" as const, timeoutMs: 60_000, spec: { kind: "build" as const, root: ".", command: "npm run build" } };
        return {
          checks: [check],
          files: new Map([[`.knyc-checks/${stepId}.test.mjs`, "test()"]]),
          report: { stepId, strength: "strong", existing: 0, generated: 1, aiCalls: 1, notes: [] },
          step: { ...step, checkIds: [check.id], checkStrength: "strong", prep: "checks-ready" },
        };
      },
    }),
  };
  return { calls, pipeline };
}

const run = (host: MemoryHost, job: Job, pipeline: PathPipeline) =>
  runJob(job, {
    host,
    statePath: "/data/jobs/job-1.json",
    stages: jobStages(job, { host, roles, pipeline, provider: () => ({ id: "claude-cli", complete: () => Promise.reject(new Error("no AI")) }) }),
  });

describe("path stages", () => {
  it("adds plan, timeline and checks to the analysis; the same choice keeps them, another starts over", () => {
    const job = { ...newAnalysisJob({ source: "/s", sourceHash: "blake3:ab", name: "n" }, { id: "j", dataDir: "/d" }), status: "done" as const };
    const chosen = withPathChoice(job, CHOICE);
    expect(chosen.status).toBe("running");
    expect(chosen.stages.map((s) => s.id)).toEqual(["intake", "scan", "graph", "summaries", "plan", "timeline", "checks"]);
    const planned = { ...chosen, stages: chosen.stages.map((s) => (s.id === "plan" ? { ...s, status: "done" as const } : s)) };
    expect(withPathChoice(planned, CHOICE).stages.find((s) => s.id === "plan")?.status).toBe("done");
    const deep = withPathChoice(planned, { ...CHOICE, size: "deep" });
    expect(deep.stages.find((s) => s.id === "plan")?.status).toBe("pending");
    expect(deep.stages).toHaveLength(7);
    expect(pathIdFor({ ...CHOICE, setupAsStep: true })).toBe("backend-standard-setup");
  });

  it("opens step 1 while the next steps are still being prepared, then the others on their own", async () => {
    const host = new MemoryHost();
    const job = await analysedJob(host);
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const { calls, pipeline } = fakePipeline({ gate: (id) => (id === STEPS[1] ? held : undefined) });

    const finished = run(host, job, pipeline);
    // Step 2's checks are on their way: step 1 is ready, the rest isn't yet.
    await expect.poll(() => calls.steps).toEqual(STEPS.slice(0, 2));
    const early = await loadPathSoFar(host, job);
    expect(early?.status).toBe("preparing");
    expect(early?.steps.map((s) => s.prep)).toEqual(["checks-ready", ...STEPS.slice(1).map(() => "reference-ready")]);
    expect(early?.steps[1]!.reference).toEqual({ commit: "c1" });
    const state = JSON.parse(host.files.get("/data/jobs/job-1.json")!) as Job;
    expect(state.stages.find((s) => s.id === "checks")).toMatchObject({ status: "running", progress: { done: 1, total: STEPS.length } });

    release();
    const done = await finished;
    expect(done.status).toBe("done");
    const path = await loadPathSoFar(host, done);
    expect(path?.status).toBe("ready");
    expect(path?.id).toBe("backend-standard");
    expect(path?.steps.every((s) => s.prep === "checks-ready" && s.checkIds.length === 1)).toBe(true);
    const saved = JSON.parse(host.files.get(pathPaths(job.cacheDir, "backend-standard").step(STEPS[0]!))!);
    expect(saved.files).toEqual({ [`.knyc-checks/${STEPS[0]}.test.mjs`]: "test()" });
  });

  it("pauses on a limit between steps and goes on with the next unprepared step", async () => {
    const host = new MemoryHost();
    const job = await analysedJob(host);
    const first = fakePipeline({
      gate: (id) => (id === STEPS[2] ? Promise.reject(new AiError("limit", "You've hit your session limit · resets 6:40pm (UTC)")) : undefined),
    });
    const paused = await run(host, job, first.pipeline);
    expect(paused.status).toBe("paused");
    expect(paused.stages.slice(4).map((s) => s.status)).toEqual(["done", "done", "paused"]);
    expect((await loadPathSoFar(host, paused))?.steps.filter((s) => s.prep === "checks-ready")).toHaveLength(2);

    const second = fakePipeline();
    const done = await run(host, paused, second.pipeline);
    expect(done.status).toBe("done");
    expect(second.calls).toEqual({ plan: 0, timeline: 0, steps: STEPS.slice(2) });
  });
});
