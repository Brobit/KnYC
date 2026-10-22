// Runs a job's stages in order, saving its state after every change (#57). A stage that finished
// is never run again; a usage limit pauses the job with a resume time; cancelling stops it cleanly;
// any other error fails it, keeping what was done. Running the same job again (after a restart, a
// pause or a failure) continues from the first unfinished stage.

import { AiError } from "../ai/types.ts";
import type { Host } from "../host/host.ts";
import type { Job, JobStage } from "../schemas/job.ts";
import { resumeTimeAfterLimit } from "./limit.ts";

export interface StageContext {
  /** Aborted when the job is cancelled: pass it to anything that can stop early. */
  signal: AbortSignal;
  /** Items done inside the stage, e.g. files summarized. */
  progress(done: number, total: number): void;
  /** One AI call was made (for the job's totals). */
  aiCall(): void;
}

export interface StageDefinition {
  id: string;
  run(context: StageContext): Promise<void>;
}

export type JobEvent = { type: "updated"; job: Job };

/** Thrown when a job was cancelled; the runner records it as such. */
export class JobCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "JobCancelled";
  }
}

export interface RunJobOptions {
  host: Host;
  /** Where the job's state is saved. */
  statePath: string;
  stages: StageDefinition[];
  signal?: AbortSignal;
  onEvent?: (event: JobEvent) => void;
  now?: () => Date;
}

/** Runs `job` from its first unfinished stage; resolves to its final state (done, paused, failed or cancelled). */
export async function runJob(initial: Job, options: RunJobOptions): Promise<Job> {
  const now = options.now ?? (() => new Date());
  const signal = options.signal ?? new AbortController().signal;
  let job: Job = { ...initial, status: "running", reason: undefined, resumeAt: undefined };

  // Saves first, then tells listeners, so what they see is always on disk. Saves go one after the
  // other (progress updates aren't awaited), so an older state never lands after a newer one.
  let saving: Promise<void> = Promise.resolve();
  const commit = (change: Partial<Job>): Promise<void> => {
    job = { ...job, ...change, updatedAt: now().toISOString() };
    const snapshot = job;
    const text = JSON.stringify(snapshot, null, 2);
    saving = saving
      .catch(() => {})
      .then(() => options.host.writeFile(options.statePath, text))
      .then(() => options.onEvent?.({ type: "updated", job: snapshot }));
    return saving;
  };
  const setStage = (id: string, change: Partial<JobStage>) =>
    commit({ stages: job.stages.map((s) => (s.id === id ? { ...s, ...change } : s)) });

  await commit({});
  for (const definition of options.stages) {
    const stage = job.stages.find((s) => s.id === definition.id);
    if (!stage) throw new Error(`job ${job.id} has no stage "${definition.id}"`);
    if (stage.status === "done") continue;
    if (signal.aborted) return cancel(definition.id);

    await setStage(definition.id, { status: "running", startedAt: now().toISOString(), error: undefined });
    try {
      await definition.run({
        signal,
        progress: (done, total) => void setStage(definition.id, { progress: { done, total } }),
        aiCall: () => void commit({ aiCalls: job.aiCalls + 1 }),
      });
      if (signal.aborted) return cancel(definition.id);
      await setStage(definition.id, { status: "done", finishedAt: now().toISOString() });
    } catch (error) {
      if (signal.aborted || error instanceof JobCancelled) return cancel(definition.id);
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AiError && error.kind === "limit") {
        await setStage(definition.id, { status: "paused" });
        await commit({ status: "paused", reason: message, resumeAt: resumeTimeAfterLimit(message, now()).toISOString() });
        return job;
      }
      await setStage(definition.id, { status: "failed", error: message });
      await commit({ status: "failed", reason: message });
      return job;
    }
  }
  await commit({ status: "done" });
  return job;

  async function cancel(stageId: string) {
    // The stage starts over next time (its partial results stay cached).
    await setStage(stageId, { status: "pending", progress: undefined });
    await commit({ status: "cancelled", reason: undefined });
    return job;
  }
}
