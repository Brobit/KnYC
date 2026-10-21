import { z } from "zod";
import { id, isoDate, trackId } from "./common.ts";
import { hintLevel } from "./lesson.ts";

export const stepProgress = z.object({
  status: z.enum(["locked", "available", "in-progress", "passed", "skipped"]),
  startedAt: isoDate.optional(),
  passedAt: isoDate.optional(),
  /** Number of check runs. */
  attempts: z.number().int().min(0).default(0),
  hintsUsed: z.array(hintLevel).default([]),
  revealed: z.boolean().default(false),
  timeSpentSec: z.number().min(0).default(0),
  /** Commit in snapshots.git, set when the step is passed. */
  snapshot: z.string().optional(),
});
export type StepProgress = z.infer<typeof stepProgress>;

export const pathProgress = z.object({
  currentStepId: id,
  startedAt: isoDate,
  completedAt: isoDate.optional(),
  steps: z.record(id, stepProgress),
});
export type PathProgress = z.infer<typeof pathProgress>;

/** `.knyc/progress.json` */
export const progress = z.object({
  schemaVersion: z.literal(1),
  activePathId: id.optional(),
  paths: z.record(id, pathProgress).default({}),
  /** Finished tracks: the learner's code replaces the original for these. */
  tracksDone: z.array(z.object({ trackId, pathId: id, snapshot: z.string().min(1) })).default([]),
});
export type Progress = z.infer<typeof progress>;
