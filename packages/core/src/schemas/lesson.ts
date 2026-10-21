import { z } from "zod";
import { id, isoDate, modelRef } from "./common.ts";

export const hintLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type HintLevel = z.infer<typeof hintLevel>;

/** `.knyc/lessons/<pathId>/<stepId>.json`, generated when the learner reaches the step. */
export const lesson = z.object({
  schemaVersion: z.literal(1),
  stepId: id,
  generatedWith: modelRef,
  at: isoDate,
  /** Markdown. */
  explanation: z.string().min(1),
  architectureNote: z.string().optional(),
  hints: z.array(z.object({ level: hintLevel, text: z.string().min(1), unlockedAt: isoDate.optional() })),
  chat: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string(), at: isoDate }))
    .default([]),
});
export type Lesson = z.infer<typeof lesson>;
