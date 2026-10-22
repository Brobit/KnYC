import { z } from "zod";
import { isoDate } from "./common.ts";

// Background jobs (#57): the analysis runs for 10–20 minutes and must survive the window, a
// usage limit and the app being closed. Each job saves its state after every change.

export const jobStageStatus = z.enum(["pending", "running", "done", "failed", "paused"]);
export type JobStageStatus = z.infer<typeof jobStageStatus>;

export const jobStage = z.object({
  id: z.string().min(1),
  status: jobStageStatus,
  startedAt: isoDate.optional(),
  finishedAt: isoDate.optional(),
  /** Items done / total inside the stage (files summarized…), when it has items. */
  progress: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }).optional(),
  error: z.string().optional(),
});
export type JobStage = z.infer<typeof jobStage>;

export const jobStatus = z.enum(["running", "paused", "failed", "cancelled", "done"]);
export type JobStatus = z.infer<typeof jobStatus>;

/** What started the analysis: everything needed to run it again after a restart. */
export const analysisInput = z.object({
  /** The folder the learner picked (read once, by intake). */
  source: z.string().min(1),
  /** Content hash from the import scan; names the cache folder. */
  sourceHash: z.string().min(1),
  name: z.string().min(1),
});
export type AnalysisInput = z.infer<typeof analysisInput>;

/** <app data>/jobs/<id>.json */
export const job = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  kind: z.literal("analysis"),
  createdAt: isoDate,
  updatedAt: isoDate,
  status: jobStatus,
  input: analysisInput,
  /** `<app data>/cache/<hash>`: the sandbox and every stage's result. */
  cacheDir: z.string().min(1),
  stages: z.array(jobStage).min(1),
  /** Paused on a usage limit: when the limit resets (estimated when the provider doesn't say). */
  resumeAt: isoDate.optional(),
  /** Why it is paused or failed, for the learner. */
  reason: z.string().optional(),
  aiCalls: z.number().int().min(0).default(0),
});
export type Job = z.infer<typeof job>;

/** <app data>/jobs/index.json: the jobs to look at when the app starts. */
export const jobs = z.object({
  schemaVersion: z.literal(1),
  ids: z.array(z.string().min(1)).default([]),
});
export type Jobs = z.infer<typeof jobs>;
