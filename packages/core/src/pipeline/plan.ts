// Stage ⑥ (design/02-analysis-pipeline.md): the curriculum plan. The AI groups units into
// milestones and steps; ids, order, dependencies and every rule are handled here, in code.

import { z } from "zod";
import type { AiClient } from "../ai/client.ts";
import type { Profile } from "../profiles/index.ts";
import type { ModelRef, TrackId } from "../schemas/common.ts";
import { checkStrategy, learningPath, type LearningPath, type PathSize, type UnitChange } from "../schemas/learning-path.ts";
import type { Summaries } from "./summaries.ts";
import { describeUnits, type Units } from "./units.ts";

/** Target step counts per size (design 02 ⑥), capped by how many units the project has. */
export function stepRange(size: PathSize, unitCount: number): { min: number; max: number } {
  const base = { overview: { min: 3, max: 7 }, standard: { min: 10, max: 20 }, deep: { min: 25, max: 50 } }[size];
  const max = Math.min(base.max, unitCount);
  const min = Math.min(base.min, Math.max(1, Math.ceil(unitCount * 0.75)), max);
  return { min, max };
}

const planStep = z.object({
  title: z.string().min(3).max(80),
  goal: z
    .string()
    .min(10)
    .max(300)
    .describe("What works after this step, as something a check can observe: 'POST /notes creates a note and returns 201'"),
  concepts: z.array(z.string().min(2).max(40)).max(5).describe("Ideas the learner meets in this step"),
  introduces: z
    .array(z.string())
    .min(1)
    .describe("Unit ids from the unit list. A file path introduces the whole file; a class id also brings its methods unless they are listed in other steps"),
  checkStrategy: checkStrategy.describe("existing-tests | unit-test | http | command | build"),
  estimatedMinutes: z.number().int().min(5).max(120),
});

const planMilestone = z.object({
  title: z.string().min(3).max(60),
  summary: z.string().min(10).max(300),
  steps: z.array(planStep).min(1),
});

export const planAnswer = z.object({ milestones: z.array(planMilestone).min(1) });
export type PlanAnswer = z.infer<typeof planAnswer>;

const stepId = (index: number) => `s${String(index + 1).padStart(2, "0")}`;

interface Placement {
  /** Atom id → index of the step that introduces it. */
  stepOf: Map<string, number>;
  problems: string[];
}

/** Where each atom lands, with every rule checked. Pure code: the same answer always gives the same problems. */
export function placeUnits(answer: PlanAnswer, units: Units, range: { min: number; max: number }): Placement {
  const steps = answer.milestones.flatMap((m) => m.steps);
  const problems: string[] = [];
  const explicit = new Set(steps.flatMap((s) => s.introduces));
  const covered = new Map<string, number[]>();
  const cover = (atom: string, step: number) => covered.set(atom, [...(covered.get(atom) ?? []), step]);

  steps.forEach((step, i) => {
    for (const entry of step.introduces) {
      if (units.byFile.has(entry)) {
        for (const atom of units.byFile.get(entry)!) cover(atom, i);
      } else if (units.byId.has(entry)) {
        cover(entry, i);
        if (units.byId.get(entry)!.kind === "class") {
          for (const method of units.atoms.filter((a) => a.parent === entry && !explicit.has(a.id))) cover(method.id, i);
        }
      } else {
        problems.push(`${stepId(i)} introduces "${entry}", which is not in the unit list (use exact unit ids or file paths)`);
      }
    }
  });

  const stepOf = new Map<string, number>();
  for (const atom of units.atoms) {
    const at = covered.get(atom.id) ?? [];
    if (at.length === 0) problems.push(`${atom.id} is never introduced`);
    else if (at.length > 1) {
      problems.push(`${atom.id} is introduced more than once (${[...new Set(at)].map(stepId).join(", ")}); introduce it in exactly one step`);
    }
    if (at.length > 0) stepOf.set(atom.id, Math.min(...at));
  }

  for (const [atom, index] of stepOf) {
    for (const need of units.needs.get(atom) ?? []) {
      const at = stepOf.get(need);
      if (at !== undefined && at > index) {
        problems.push(`${stepId(index)} introduces ${atom}, which needs ${need}, introduced later in ${stepId(at)}`);
      }
    }
  }

  if (steps.length < range.min || steps.length > range.max) {
    problems.push(`the plan has ${steps.length} steps; this size needs between ${range.min} and ${range.max}`);
  }
  return { stepOf, problems };
}

/** The answer schema: plan shape + every placement rule, so violations are sent back to the AI. */
export function planSchema(units: Units, range: { min: number; max: number }, maxProblems = 20) {
  return planAnswer.superRefine((answer, ctx) => {
    const { problems } = placeUnits(answer, units, range);
    for (const message of problems.slice(0, maxProblems)) ctx.addIssue({ code: "custom", path: ["milestones"], message });
    if (problems.length > maxProblems) {
      ctx.addIssue({ code: "custom", path: ["milestones"], message: `…and ${problems.length - maxProblems} more problems of the same kinds` });
    }
  });
}

export const PLANNER_SYSTEM = `You are the curriculum designer of KnYC, an app that teaches developers a codebase by having them rebuild it from an empty folder, one step at a time.
A good path starts from something that runs and grows it feature by feature. Each step is small enough to do in 15-45 minutes, has one clear goal the learner can see working, and only uses code from earlier steps.
Follow the unit list exactly: every unit is introduced exactly once, never before what it needs.`;

export interface PlanInput {
  track: TrackId;
  size: PathSize;
  units: Units;
  summaries: Summaries;
  profile?: Profile;
  /** The project has its own tests (they can check steps). */
  hasTests: boolean;
}

export function planPrompt(input: PlanInput): string {
  const { units, summaries, profile } = input;
  const range = stepRange(input.size, units.atoms.length);
  const purposes = new Map<string, string>();
  for (const file of summaries.files) {
    for (const symbol of file.keySymbols) purposes.set(`${file.path}#${symbol.name}`, symbol.purpose);
    if (units.byId.has(file.path)) purposes.set(file.path, file.summary);
  }

  return `Plan the "${input.track}" path at size "${input.size}": between ${range.min} and ${range.max} steps, grouped into milestones.

# Project
${summaries.project.name}: ${summaries.project.purpose}
Architecture: ${summaries.project.architecture}
Entry points: ${summaries.project.entryPoints.join(", ")}

# Folders
${summaries.modules.map((m) => `- ${m.module}: ${m.summary}`).join("\n")}

# Files
${summaries.files.map((f) => `- ${f.path}: ${f.role}`).join("\n")}
${
  profile
    ? `
# ${profile.label} projects
Natural build order:
${profile.buildOrder.map((s, i) => `${i + 1}. ${s}`).join("\n")}
How steps are usually checked:
${profile.checkHints.map((h) => `- ${h}`).join("\n")}
`
    : ""
}
# Checks
${input.hasTests ? "The project has its own test suite: prefer \"existing-tests\" where its tests cover the step." : "The project has no tests: use \"http\", \"unit-test\", \"command\" or \"build\"."}

# Units (${units.atoms.length}), leaves first. "needs" lists what each unit uses.
${describeUnits(units, purposes)}

Rules:
- Every unit above is introduced exactly once. A file path introduces all of that file's units.
- A step may only introduce a unit if everything it "needs" is introduced in the same step or an earlier one.
- Prefer steps that end with something observable (a route answering, a function returning the right value), and goals phrased that way.
- Group steps into 2-6 milestones that tell the story of the project.`;
}

export interface GeneratePlanOptions {
  planning: ModelRef;
  onRetry?: (problems: string[]) => void;
  retries?: number;
  now?: () => Date;
}

/** Converts a valid answer into a LearningPath document (design 03). */
export function toLearningPath(input: PlanInput, answer: PlanAnswer, options: GeneratePlanOptions): LearningPath {
  const range = stepRange(input.size, input.units.atoms.length);
  const { stepOf, problems } = placeUnits(answer, input.units, range);
  if (problems.length > 0) throw new Error(`invalid plan:\n- ${problems.join("\n- ")}`);

  const flat = answer.milestones.flatMap((m) => m.steps);
  const fileFirstStep = new Map<string, number>();
  for (const atom of input.units.atoms) {
    const at = stepOf.get(atom.id)!;
    fileFirstStep.set(atom.file, Math.min(fileFirstStep.get(atom.file) ?? at, at));
  }

  let index = 0;
  const steps = flat.map((step, i) => {
    const introduces: UnitChange[] = step.introduces.map((unit) => {
      const atom = input.units.byId.get(unit);
      const file = atom?.file ?? unit;
      const kind: UnitChange["kind"] =
        !atom || atom.kind === "file" ? "file" : atom.kind === "function" || atom.kind === "class" || atom.kind === "method" ? atom.kind : "other";
      return { unit, kind, change: (fileFirstStep.get(file) ?? i) < i ? "extend" : "add" };
    });
    const mine = [...stepOf].filter(([, at]) => at === i).map(([atom]) => atom);
    const dependsOn = new Set<number>();
    for (const atom of mine) {
      for (const need of input.units.needs.get(atom) ?? []) {
        const at = stepOf.get(need)!;
        if (at < i) dependsOn.add(at);
      }
    }
    return {
      id: stepId(i),
      index: index++,
      title: step.title,
      goal: step.goal,
      concepts: step.concepts,
      introduces,
      dependsOn: [...dependsOn].sort((a, b) => a - b).map(stepId),
      checkIds: [],
      estimatedMinutes: step.estimatedMinutes,
      prep: "planned" as const,
      checkStrategy: step.checkStrategy,
    };
  });

  let cursor = 0;
  const milestones = answer.milestones.map((m, i) => {
    const ids = m.steps.map(() => stepId(cursor++));
    return { id: `m${i + 1}`, title: m.title, summary: m.summary, stepIds: ids };
  });

  return learningPath.parse({
    schemaVersion: 1,
    id: `${input.track}-${input.size}`,
    trackId: input.track,
    size: input.size,
    setupAsStep: false,
    sharedUnits: [],
    generatedWith: { planning: options.planning, at: (options.now ?? (() => new Date()))().toISOString() },
    status: "preparing",
    milestones,
    steps,
  });
}

export async function generatePlan(client: AiClient, input: PlanInput, options: GeneratePlanOptions) {
  const range = stepRange(input.size, input.units.atoms.length);
  const result = await client.generate({
    role: "planning",
    system: PLANNER_SYSTEM,
    prompt: planPrompt(input),
    schema: planSchema(input.units, range),
    retries: options.retries ?? 3,
    onRetry: (_attempt, problems) => options.onRetry?.(problems),
  });
  return { path: toLearningPath(input, result.data, options), usage: result.usage, calls: result.calls, cached: result.cached };
}
