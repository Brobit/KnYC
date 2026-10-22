import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiError, JobRegistry, MemoryHost, newAnalysisJob, type Job, type StageDefinition } from "@knyc/core";
import { defaultSettings } from "@knyc/core/schemas";
import { JobManager, type JobManagerDependencies } from "@/jobs/job-manager";
import { JobsProvider, useJobs } from "@/jobs/jobs-context";
import { AppClaudeProvider, type ClaudeOutcome } from "@/lib/claude-provider";
import { SettingsProvider } from "@/lib/settings";

const INPUT = { source: "/src/notes", sourceHash: "blake3:abcdef0123456789", name: "notes" };
const never = new Promise<void>(() => {});

/**
 * The job's own stages (intake, scan, graph, summaries), logged as a, b, c, d. The second one can
 * hang (the app closed), wait for the cancel, or hit a usage limit.
 */
function stages(log: string[], b: "ok" | "hang" | "until-cancel" | "limit" = "ok"): JobManagerDependencies["stages"] {
  return (job, signal) =>
    job.stages.map<StageDefinition>(({ id }, index) => ({
      id,
      async run() {
        const name = "abcd"[index];
        log.push(name);
        if (name !== "b") return;
        if (b === "hang") await never;
        if (b === "until-cancel") await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        if (b === "limit") throw new AiError("limit", "You've hit your session limit · resets 6:40pm (Europe/Paris)");
      },
    }));
}

function manager(host: MemoryHost, log: string[], b: Parameters<typeof stages>[1] = "ok", extra: Partial<JobManagerDependencies> = {}) {
  return new JobManager({
    host,
    dataDir: async () => "/data",
    roles: () => defaultSettings().roles,
    provider: () => {
      throw new Error("no AI in these tests");
    },
    stages: stages(log, b),
    newId: () => "job-1",
    ...extra,
  });
}

/** What the registry holds for job-1, as the next app start reads it. */
const onDisk = async (host: MemoryHost) => new JobRegistry(host, "/data").load("job-1");

describe("JobManager", () => {
  it("goes on where it stopped after the app is closed in the middle of an analysis", async () => {
    const host = new MemoryHost();
    const firstLog: string[] = [];
    const first = manager(host, firstLog, "hang");
    await first.startAnalysis(INPUT);
    await waitFor(async () => expect((await onDisk(host)).stages.map((s) => s.status)).toEqual(["done", "running", "pending", "pending"]));
    // The app is closed here: `first` is never heard from again.

    const log: string[] = [];
    const reopened = manager(host, log);
    await reopened.init();
    const done = await reopened.whenSettled("job-1");
    expect(done?.status).toBe("done");
    expect(log).toEqual(["b", "c", "d"]);
    expect(firstLog).toEqual(["a", "b"]);
    expect((await onDisk(host)).status).toBe("done");
  });

  it("pauses on a usage limit and resumes on its own when the limit has reset", async () => {
    const host = new MemoryHost();
    let clock = new Date("2026-10-22T10:00:00Z");
    const first = manager(host, [], "limit", { now: () => clock });
    await first.startAnalysis(INPUT);
    const paused = await first.whenSettled("job-1");
    expect(paused?.status).toBe("paused");
    expect(paused?.resumeAt).toBe("2026-10-22T16:41:00.000Z");

    // Reopened after the reset: the paused job starts again at once.
    clock = new Date("2026-10-22T17:00:00Z");
    const log: string[] = [];
    const later = manager(host, log, "ok", { now: () => clock });
    await later.init();
    await waitFor(async () => expect((await onDisk(host)).status).toBe("done"));
    expect(log).toEqual(["b", "c", "d"]);
  });

  it("cancels a running job; resuming starts the interrupted stage over", async () => {
    const host = new MemoryHost();
    const log: string[] = [];
    const jobs = manager(host, log, "until-cancel");
    await jobs.startAnalysis(INPUT);
    await waitFor(() => expect(log).toEqual(["a", "b"]));
    await jobs.cancel("job-1");
    const cancelled = await onDisk(host);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.stages.map((s) => s.status)).toEqual(["done", "pending", "pending", "pending"]);
    expect(jobs.getSnapshot().map((j) => j.status)).toEqual(["cancelled"]);

    jobs.resume("job-1");
    await waitFor(() => expect(log).toEqual(["a", "b", "b"]));
    expect(jobs.getSnapshot().map((j) => j.status)).toEqual(["running"]);
    await jobs.cancel("job-1");
  });

  it("cancels a paused job so it doesn't come back, and forgets removed jobs", async () => {
    const host = new MemoryHost();
    const registry = new JobRegistry(host, "/data");
    const paused: Job = { ...newAnalysisJob(INPUT, { id: "job-1", dataDir: "/data" }), status: "paused", resumeAt: "2099-01-01T00:00:00.000Z" };
    await registry.add(paused);
    const log: string[] = [];
    const jobs = manager(host, log);
    await jobs.init();
    await jobs.cancel("job-1");
    expect((await onDisk(host)).status).toBe("cancelled");
    await jobs.remove("job-1");
    expect(await registry.list()).toEqual([]);
    expect(jobs.getSnapshot()).toEqual([]);
    expect(log).toEqual([]);
  });
});

describe("AppClaudeProvider cancel", () => {
  it("kills the call in flight when the job's signal aborts", async () => {
    const controller = new AbortController();
    const cancelled: string[] = [];
    let release: (outcome: ClaudeOutcome) => void = () => {};
    const seen: (string | undefined)[] = [];
    const provider = new AppClaudeProvider(
      (call) => {
        seen.push(call.id);
        return new Promise((resolve) => (release = resolve));
      },
      { signal: controller.signal, cancel: async (id) => void cancelled.push(id) },
    );
    const answer = provider.complete({ model: "haiku", system: "s", prompt: "p", jsonSchema: {}, timeoutMs: 1000 }).catch((e: unknown) => e);
    controller.abort();
    expect(cancelled).toEqual([seen[0]]);
    release({ found: true, startError: null, stdout: "", stderr: "", code: null, timedOut: false, truncated: false, cancelled: true });
    expect(((await answer) as Error).message).toBe("cancelled");
    // Once cancelled, no new call starts.
    expect(((await provider.complete({ model: "haiku", system: "s", prompt: "p", jsonSchema: {}, timeoutMs: 1000 }).catch((e: unknown) => e)) as Error).message).toBe("cancelled");
    expect(seen).toHaveLength(1);
  });
});

function JobList() {
  const { available, jobs } = useJobs();
  return (
    <ul aria-label={available ? "jobs" : "unavailable"}>
      {jobs.map((job) => (
        <li key={job.id}>
          {job.input.name}: {job.status}
        </li>
      ))}
    </ul>
  );
}

describe("JobsProvider", () => {
  it("is unavailable in a plain browser", () => {
    render(
      <SettingsProvider initial={defaultSettings()}>
        <JobsProvider>
          <JobList />
        </JobsProvider>
      </SettingsProvider>,
    );
    expect(screen.getByRole("list", { name: "unavailable" })).toBeInTheDocument();
  });

  it("shows jobs live, including ones found at start", async () => {
    const host = new MemoryHost();
    await new JobRegistry(host, "/data").add({ ...newAnalysisJob(INPUT, { id: "job-1", dataDir: "/data" }), status: "cancelled" });
    render(
      <SettingsProvider initial={defaultSettings()}>
        <JobsProvider manager={manager(host, [])}>
          <JobList />
        </JobsProvider>
      </SettingsProvider>,
    );
    expect(await screen.findByText("notes: cancelled")).toBeInTheDocument();
  });
});
