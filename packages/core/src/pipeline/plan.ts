// Stage ⑥ (design/02-analysis-pipeline.md): the curriculum plan. The AI groups units into
// milestones and steps; ids, order, dependencies and every rule are handled here, in code.

import { z } from "zod";
import type { AiClient } from "../ai/client.ts";
import type { Profile } from "../profiles/index.ts";
import type { ModelRef, TrackId } from "../schemas/common.ts";
import { checkStrategy, learningPath, type LearningPath, type PathSize, type UnitChange } from "../schemas/learning-path.ts";
import type { Summaries } from "./summaries.ts";
import type { TrackContract } from "./tracks.ts";
import { describeUnits, hasBehavior, type Units } from "./units.ts";

/**
 * Target step counts per size (design 02 ⑥), capped by how many units with behavior the project
 * has: each step needs at least one (see stepsWithoutBehavior).
 */
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
  // "ui" comes to the planner with the frontend profiles (#92).
  checkStrategy: checkStrategy.exclude(["ui"]).describe("existing-tests | unit-test | http | command | build"),
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

/** Units with behavior: the most steps a plan can have. */
export const behaviorCount = (units: Units) => units.atoms.filter(hasBehavior).length;

/**
 * A new plan's steps each introduce something a check can run (design/08, improvement 1). Kept out
 * of placeUnits, which also replays paths planned before this rule.
 */
export function stepsWithoutBehavior(answer: PlanAnswer, units: Units, stepOf: Map<string, number>): string[] {
  const count = answer.milestones.reduce((n, m) => n + m.steps.length, 0);
  const problems: string[] = [];
  for (let i = 0; i < count; i++) {
    const mine = [...stepOf].filter(([, at]) => at === i).map(([id]) => units.byId.get(id)!);
    if (mine.length === 0 || mine.some(hasBehavior)) continue;
    problems.push(
      `${stepId(i)} only introduces types or private code (${mine.map((a) => a.id).join(", ")}); every step needs an exported function, class, method or value — move these into the step that first uses them`,
    );
  }
  return problems;
}

/** Every rule a newly generated plan must follow. */
function planProblems(answer: PlanAnswer, units: Units, range: { min: number; max: number }) {
  const { stepOf, problems } = placeUnits(answer, units, range);
  return { stepOf, problems: [...problems, ...stepsWithoutBehavior(answer, units, stepOf)] };
}

/** The answer schema: plan shape + every placement rule, so violations are sent back to the AI. */
export function planSchema(units: Units, range: { min: number; max: number }, maxProblems = 20) {
  return planAnswer.superRefine((answer, ctx) => {
    const { problems } = planProblems(answer, units, range);
    for (const message of problems.slice(0, maxProblems)) ctx.addIssue({ code: "custom", path: ["milestones"], message });
    if (problems.length > maxProblems) {
      ctx.addIssue({ code: "custom", path: ["milestones"], message: `…and ${problems.length - maxProblems} more problems of the same kinds` });
    }
  });
}

export const PLANNER_SYSTEM = `You are the curriculum designer of KnYC, an app that teaches developers a codebase by having them rebuild it from an empty folder, one step at a time.
A good path starts from something that runs and grows it feature by feature. Each step is small enough to do in 15-45 minutes, has one clear goal the learner can see working, and only uses code from earlier steps.
Follow the unit list exactly: every unit is introduced exactly once, never before what it needs, and every step introduces code that runs.`;

export interface PlanInput {
  track: TrackId;
  size: PathSize;
  units: Units;
  summaries: Summaries;
  profile?: Profile;
  /** The project has its own tests (they can check steps). */
  hasTests: boolean;
  /** On a track path: what the other tracks provide as the original code (#86). */
  otherTracks?: TrackContract[];
}

/** One line per contract another track provides, for the planner. */
function describeContracts(contracts: TrackContract[]): string {
  return contracts
    .slice(0, 60)
    .map(({ track, contract }) =>
      contract.kind === "http"
        ? `- ${track} serves ${contract.method} ${contract.path}`
        : contract.kind === "env"
          ? `- ${track} reads the environment variable ${contract.name}`
          : `- ${track} defines the table ${contract.name}${contract.columns.length ? ` (${contract.columns.join(", ")})` : ""}`,
    )
    .join("\n");
}

export function planPrompt(input: PlanInput): string {
  const { units, summaries, profile } = input;
  const range = stepRange(input.size, behaviorCount(units));
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
# ${profile.kind === "generic" ? "Projects in general" : `${profile.label} projects`}
Natural build order:
${profile.buildOrder.map((s, i) => `${i + 1}. ${s}`).join("\n")}
How steps are usually checked:
${profile.check.hints.map((h) => `- ${h}`).join("\n")}
`
    : ""
}
${
  input.otherTracks && input.otherTracks.length > 0
    ? `# The other tracks
They stay the original code while the learner rebuilds this track; the units below can use them:
${describeContracts(input.otherTracks)}

`
    : ""
}# Checks
${input.hasTests ? "The project has its own test suite: prefer \"existing-tests\" where its tests cover the step." : "The project has no tests: use \"http\", \"unit-test\", \"command\" or \"build\"."}

# Units (${units.atoms.length}), leaves first. "needs" lists what each unit uses.
${describeUnits(units, purposes)}

Rules:
- Every unit above is introduced exactly once. A file path introduces all of that file's units.
- A step may only introduce a unit if everything it "needs" is introduced in the same step or an earlier one.
- Every step introduces at least one exported function, class, method or value (units not marked "private" that aren't types), or a whole entry-point file: something its check can run. Types, interfaces, enums and private helpers go in the step that first uses them.
- Prefer steps that end with something observable (a route answering, a function returning the right value), and goals phrased that way.
- Code that reads data (list, get, find) goes in the same step as the code that adds that data (create, save), or after it: on an empty store a read can only be checked returning nothing.
- In each goal, name what a check will call or read when the learner can't guess it: a parameter the code takes (a clock, a store, a limit), a route like /health, the exact response or output.
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
  const range = stepRange(input.size, behaviorCount(input.units));
  const { stepOf, problems } = planProblems(answer, input.units, range);
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
  const range = stepRange(input.size, behaviorCount(input.units));
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
