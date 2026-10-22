import { describe, expect, it } from "vitest";
import graphFixture from "./fixtures/graphs/express-notes.json";
import {
  AiError,
  analysisPaths,
  analysisStages,
  JobRegistry,
  limitResetTime,
  loadAnalysis,
  loadDocument,
  MemoryHost,
  newAnalysisJob,
  resumeTimeAfterLimit,
  runJob,
  type AiProvider,
  type Job,
  type JobEvent,
  type ProviderRequest,
  type ProviderResponse,
  type StageDefinition,
  type SysRequest,
} from "../src/index.ts";

describe("limitResetTime", () => {
  const paris = "You've hit your session limit · resets 6:40pm (Europe/Paris)";

  it("reads the reset time in the zone Claude Code names", () => {
    // Paris is UTC+2 until 25 October 2026.
    expect(limitResetTime(paris, new Date("2026-10-22T10:00:00Z"))?.toISOString()).toBe("2026-10-22T16:40:00.000Z");
  });

  it("takes the next day once the time has passed, across a daylight-saving change", () => {
    expect(limitResetTime(paris, new Date("2026-10-22T17:00:00Z"))?.toISOString()).toBe("2026-10-23T16:40:00.000Z");
    // 24 → 25 October: Paris goes back to UTC+1.
    expect(limitResetTime(paris, new Date("2026-10-24T20:00:00Z"))?.toISOString()).toBe("2026-10-25T17:40:00.000Z");
  });

  it("handles 12am / 12pm and gives up on messages without a time", () => {
    expect(limitResetTime("resets 12am (UTC)", new Date("2026-10-22T10:00:00Z"))?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect(limitResetTime("resets 12pm (UTC)", new Date("2026-10-22T10:00:00Z"))?.toISOString()).toBe("2026-10-22T12:00:00.000Z");
    expect(limitResetTime("rate limit reached, try later", new Date())).toBeNull();
    const now = new Date("2026-10-22T10:00:00Z");
    expect(resumeTimeAfterLimit("rate limit reached", now).toISOString()).toBe("2026-10-22T10:30:00.000Z");
    expect(resumeTimeAfterLimit(paris, now).toISOString()).toBe("2026-10-22T16:41:00.000Z");
  });
});

const job = (stages: string[]): Job => ({
  schemaVersion: 1,
  id: "job-1",
  kind: "analysis",
  createdAt: "2026-10-22T10:00:00.000Z",
  updatedAt: "2026-10-22T10:00:00.000Z",
  status: "running",
  input: { source: "/src/notes", sourceHash: "blake3:abc", name: "notes" },
  cacheDir: "/data/cache/abc",
  stages: stages.map((id) => ({ id, status: "pending" as const })),
  aiCalls: 0,
});

const STATE = "/data/jobs/job-1.json";
const saved = (host: MemoryHost) => loadDocument("job", JSON.parse(host.files.get(STATE)!));

function recordingStages(log: string[], behaviour: Record<string, (ctx: Parameters<StageDefinition["run"]>[0]) => Promise<void>> = {}): StageDefinition[] {
  return ["a", "b", "c"].map((id) => ({
    id,
    async run(ctx) {
      log.push(id);
      await behaviour[id]?.(ctx);
    },
  }));
}

describe("runJob", () => {
  it("runs the stages in order, saving progress, and skips finished ones next time", async () => {
    const host = new MemoryHost();
    const log: string[] = [];
    const events: JobEvent[] = [];
    const stages = recordingStages(log, { b: async (ctx) => ctx.progress(2, 5) });
    const done = await runJob(job(["a", "b", "c"]), { host, statePath: STATE, stages, onEvent: (e) => events.push(e) });
    expect(done.status).toBe("done");
    expect(log).toEqual(["a", "b", "c"]);
    expect(saved(host).stages.map((s) => s.status)).toEqual(["done", "done", "done"]);
    expect(saved(host).stages[1].progress).toEqual({ done: 2, total: 5 });
    expect(events[events.length - 1].job.status).toBe("done");

    log.length = 0;
    await runJob(saved(host), { host, statePath: STATE, stages });
    expect(log).toEqual([]);
  });

  it("goes on after a crash from the stage that was running", async () => {
    // What the app leaves on disk when it is closed during stage b.
    const crashed = job(["a", "b", "c"]);
    crashed.stages[0].status = "done";
    crashed.stages[1].status = "running";
    const host = new MemoryHost();
    const log: string[] = [];
    expect((await runJob(crashed, { host, statePath: STATE, stages: recordingStages(log) })).status).toBe("done");
    expect(log).toEqual(["b", "c"]);
  });

  it("pauses on a usage limit with the reset time, then resumes from that stage", async () => {
    const host = new MemoryHost();
    const log: string[] = [];
    let limited = true;
    const stages = recordingStages(log, {
      b: async () => {
        if (limited) throw new AiError("limit", "Claude Code usage limit reached: You've hit your session limit · resets 6:40pm (Europe/Paris)");
      },
    });
    const now = () => new Date("2026-10-22T10:00:00Z");
    const paused = await runJob(job(["a", "b", "c"]), { host, statePath: STATE, stages, now });
    expect(paused.status).toBe("paused");
    expect(paused.resumeAt).toBe("2026-10-22T16:41:00.000Z");
    expect(paused.reason).toContain("session limit");
    expect(saved(host).stages.map((s) => s.status)).toEqual(["done", "paused", "pending"]);

    limited = false;
    log.length = 0;
    const resumed = await runJob(saved(host), { host, statePath: STATE, stages, now });
    expect(resumed.status).toBe("done");
    expect(resumed.resumeAt).toBeUndefined();
    expect(log).toEqual(["b", "c"]);
  });

  it("cancels cleanly: the running stage starts over next time", async () => {
    const host = new MemoryHost();
    const controller = new AbortController();
    const log: string[] = [];
    const stages = recordingStages(log, {
      b: async (ctx) => {
        ctx.progress(1, 4);
        controller.abort();
        // A stage notices the abort through its signal (an AI call being killed, here).
        if (ctx.signal.aborted) throw new Error("the call was stopped");
      },
    });
    const cancelled = await runJob(job(["a", "b", "c"]), { host, statePath: STATE, stages, signal: controller.signal });
    expect(cancelled.status).toBe("cancelled");
    expect(log).toEqual(["a", "b"]);
    expect(saved(host).stages.map((s) => [s.status, s.progress])).toEqual([
      ["done", undefined],
      ["pending", undefined],
      ["pending", undefined],
    ]);
  });

  it("fails with the reason and keeps what was done", async () => {
    const host = new MemoryHost();
    const stages = recordingStages([], {
      c: async () => {
        throw new Error("no source code found to learn from");
      },
    });
    const failed = await runJob(job(["a", "b", "c"]), { host, statePath: STATE, stages });
    expect(failed.status).toBe("failed");
    expect(failed.reason).toBe("no source code found to learn from");
    expect(saved(host).stages.map((s) => s.status)).toEqual(["done", "done", "failed"]);
  });
});

/** Answers like a well-behaved model (summaries of files, folders, the project). */
class SummariesModel implements AiProvider {
  readonly id = "claude-cli";
  calls = 0;
  /** Throws a usage limit on that call number, once. */
  limitAt: number | null = null;

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls += 1;
    if (this.calls === this.limitAt) {
      this.limitAt = null;
      throw new AiError("limit", "You've hit your session limit · resets 6:40pm (Europe/Paris)");
    }
    const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const answer = (json: unknown) => ({ json, usage, costUsd: null, durationMs: 1 });
    const sections = [...req.prompt.matchAll(/^### (\S+)/gm)].map((m) => m[1]);
    if (req.prompt.startsWith("Summarize each of these")) {
      return answer({ files: sections.map((path) => ({ path, role: `role of ${path}`, summary: `This file ${path} does one clear thing for the app.`, keySymbols: [] })) });
    }
    if (req.prompt.startsWith("Summarize each folder")) {
      return answer({ modules: sections.map((module) => ({ module, summary: `Folder ${module} groups related code.` })) });
    }
    return answer({ name: "notes", purpose: "A small notes API used in the tests.", architecture: "Routes call a store through validation.", keyConcepts: ["routing"] });
  }
}

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

/** knyc-sys answered like Rust would; intake "copies" the project into the sandbox. */
function analysisHost() {
  const host: MemoryHost = new MemoryHost({
    sys: (request: SysRequest) => {
      if (request.op === "intake") {
        for (const file of graphFixture.files) host.files.set(`${request.sandbox}/${file.path}`, `export const x = "${file.path}";\n`);
        return { source: request.source, sandbox: request.sandbox, hash: "blake3:abc", filesCopied: graphFixture.files.length, filesForAi: 8, excluded: [], secretLines: [] };
      }
      if (request.op === "scan") return SCAN;
      if (request.op === "graph") return graphFixture;
      throw new Error(`unexpected ${request.op}`);
    },
  });
  return host;
}

describe("analysis job", () => {
  const roles = {
    summaries: { providerId: "claude-cli", model: "haiku" },
    planning: { providerId: "claude-cli", model: "sonnet" },
    lessons: { providerId: "claude-cli", model: "sonnet" },
  };

  it("runs intake → scan → graph → summaries into cache/<hash>, pausing on a limit without losing work", async () => {
    const host = analysisHost();
    const model = new SummariesModel();
    model.limitAt = 2;
    const registry = new JobRegistry(host, "/data");
    const initial = newAnalysisJob({ source: "/src/notes", sourceHash: "blake3:abcdef0123456789ffff", name: "notes" }, { id: "job-1", dataDir: "/data" });
    expect(initial.cacheDir).toBe("/data/cache/abcdef0123456789");
    await registry.add(initial);

    const run = (current: Job) =>
      runJob(current, { host, statePath: registry.statePath(current.id), stages: analysisStages(current, { host, provider: () => model, roles }) });

    const paused = await run(initial);
    expect(paused.status).toBe("paused");
    expect(paused.stages.map((s) => s.status)).toEqual(["done", "done", "done", "paused"]);
    const callsBeforePause = model.calls;
    expect(paused.aiCalls).toBe(1);

    // The app restarts: the registry still lists the job, and it goes on from summaries.
    const [reloaded] = await new JobRegistry(host, "/data").list();
    expect(reloaded.status).toBe("paused");
    const done = await run(reloaded);
    expect(done.status).toBe("done");
    expect(host.sysCalls.map((r) => r.op)).toEqual(["intake", "scan", "graph"]);

    // Against the same analysis without a limit: only the refused call is extra, so the batch
    // summarized before the limit came from the cache instead of a new call.
    const control = new SummariesModel();
    const controlHost = analysisHost();
    const controlJob = newAnalysisJob(initial.input, { id: "control", dataDir: "/data" });
    await runJob(controlJob, { host: controlHost, statePath: "/data/jobs/control.json", stages: analysisStages(controlJob, { host: controlHost, provider: () => control, roles }) });
    expect(callsBeforePause).toBe(2);
    expect(model.calls).toBe(control.calls + 1);
    expect(done.aiCalls).toBe(control.calls);

    const result = await loadAnalysis(host, done.cacheDir);
    expect(result.summaries.files.map((f) => f.path).sort()).toEqual(graphFixture.files.filter((f) => !f.test).map((f) => f.path).sort());
    expect(result.summaries.project.name).toBe("notes");
    expect(host.files.has(analysisPaths(done.cacheDir).scan)).toBe(true);
  });

  it("starts an interrupted intake over in an empty sandbox", async () => {
    const host = analysisHost();
    const job1 = newAnalysisJob({ source: "/src/notes", sourceHash: "blake3:abc", name: "notes" }, { id: "j", dataDir: "/data" });
    const sandbox = analysisPaths(job1.cacheDir).sandbox;
    host.files.set(`${sandbox}/half-copied.ts`, "x");
    await analysisStages(job1, { host, provider: () => new SummariesModel(), roles })[0].run({ signal: new AbortController().signal, progress: () => {}, aiCall: () => {} });
    expect(host.files.has(`${sandbox}/half-copied.ts`)).toBe(false);
    expect(host.files.has(`${sandbox}/src/app.ts`)).toBe(true);
  });
});

describe("JobRegistry", () => {
  it("lists, reloads and forgets jobs; an unreadable job is skipped", async () => {
    const host = new MemoryHost();
    const registry = new JobRegistry(host, "/data");
    await Promise.all([registry.add({ ...job(["a"]), id: "one" }), registry.add({ ...job(["a"]), id: "two" })]);
    expect((await registry.list()).map((j) => j.id)).toEqual(["one", "two"]);
    host.files.set(registry.statePath("two"), "{ not json");
    expect((await registry.list()).map((j) => j.id)).toEqual(["one"]);
    await registry.remove("one");
    expect(await registry.list()).toEqual([]);
    expect(host.files.has(registry.statePath("one"))).toBe(false);
  });
});
