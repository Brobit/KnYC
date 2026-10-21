import { z } from "zod";
import { id, isoDate, modelRef, trackId, unitId } from "./common.ts";

export const pathSize = z.enum(["overview", "standard", "deep"]);
export type PathSize = z.infer<typeof pathSize>;

export const checkStrategy = z.enum(["existing-tests", "unit-test", "http", "command", "build"]);
export type CheckStrategy = z.infer<typeof checkStrategy>;

export const unitChange = z.object({
  unit: unitId,
  kind: z.enum(["file", "function", "class", "method", "component", "route", "config", "other"]),
  /** "extend" = the unit already exists and grows in this step. */
  change: z.enum(["add", "extend"]),
});
export type UnitChange = z.infer<typeof unitChange>;

export const step = z.object({
  id,
  index: z.number().int().min(0),
  title: z.string().min(1),
  goal: z.string().min(1),
  concepts: z.array(z.string()).default([]),
  introduces: z.array(unitChange).min(1),
  dependsOn: z.array(id).default([]),
  checkIds: z.array(id).default([]),
  estimatedMinutes: z.number().int().positive(),
  prep: z.enum(["planned", "reference-ready", "checks-ready", "ready"]).default("planned"),
  /** How the plan intends to check this step (design 02 ⑥); the checks stage may still fall back. */
  checkStrategy: checkStrategy.optional(),
  /** weak = build-only or AI-judged (design 02 ⑧). */
  checkStrength: z.enum(["strong", "weak"]).optional(),
  /** Commit of R_k in the cache's reference.git, once built. */
  reference: z.object({ commit: z.string().min(1) }).optional(),
});
export type Step = z.infer<typeof step>;

export const milestone = z.object({
  id,
  title: z.string().min(1),
  summary: z.string(),
  stepIds: z.array(id).min(1),
});
export type Milestone = z.infer<typeof milestone>;

/** `.knyc/paths/<pathId>.json`: one track at one size. */
export const learningPath = z
  .object({
    schemaVersion: z.literal(1),
    id,
    trackId,
    size: pathSize,
    setupAsStep: z.boolean(),
    sharedUnits: z.array(z.object({ unit: unitId, mode: z.enum(["provided", "taught"]) })).default([]),
    generatedWith: z.object({ planning: modelRef, at: isoDate }),
    status: z.enum(["preparing", "ready", "partial"]),
    milestones: z.array(milestone),
    steps: z.array(step).min(1),
  })
  .superRefine((path, ctx) => {
    // Structural integrity only. Semantic plan checks (every unit once, graph order) live in the
    // curriculum validator (issue #11).
    const stepIds = new Set<string>();
    path.steps.forEach((s, i) => {
      if (stepIds.has(s.id)) ctx.addIssue({ code: "custom", path: ["steps", i, "id"], message: `duplicate step id ${s.id}` });
      if (s.index !== i) ctx.addIssue({ code: "custom", path: ["steps", i, "index"], message: `index should be ${i}` });
      for (const dep of s.dependsOn) {
        if (!stepIds.has(dep)) {
          ctx.addIssue({ code: "custom", path: ["steps", i, "dependsOn"], message: `${dep} is not an earlier step` });
        }
      }
      stepIds.add(s.id);
    });
    const inMilestones = path.milestones.flatMap((m) => m.stepIds);
    for (const sid of inMilestones) {
      if (!stepIds.has(sid)) ctx.addIssue({ code: "custom", path: ["milestones"], message: `unknown step ${sid}` });
    }
    if (new Set(inMilestones).size !== inMilestones.length || inMilestones.length !== path.steps.length) {
      ctx.addIssue({ code: "custom", path: ["milestones"], message: "every step must belong to exactly one milestone" });
    }
  });
export type LearningPath = z.infer<typeof learningPath>;
