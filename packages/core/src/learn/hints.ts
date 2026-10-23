// The help ladder of a step (#63, design/04 "help is a ladder", design/02 ⑨): hint 1 nudges,
// hint 2 gives the approach, hint 3 is close to the solution; the last rung reveals the original
// (R_k-1 → R_k). Hints are written on demand from what the learner wrote and what failed, kept in
// the step's lesson, and every rung is counted in progress.json.

import { z } from "zod";
import type { AiClient } from "../ai/client.ts";
import type { Host } from "../host/host.ts";
import type { HintLevel, Lesson } from "../schemas/lesson.ts";
import type { Progress, StepProgress } from "../schemas/progress.ts";
import { stepContext, type LessonInput } from "./lesson.ts";

export const HINT_SYSTEM = `You are the teacher in KnYC, an app where developers learn a real codebase by rebuilding it one step at a time until the step's checks pass.
The learner is stuck and asked for a hint. Help them take the next step themselves: the hint is about what they wrote and what failed, at exactly the level asked for.`;

const LEVELS: Record<HintLevel, string> = {
  1: "Hint 1, a nudge: point at where the problem is or what is missing, in one to three sentences. No code, no step-by-step.",
  2: "Hint 2, the approach: explain how to solve it (which function, which API, in what order), in a short paragraph or a few bullets. Code only as names, not lines.",
  3: "Hint 3, near the solution: walk through the change file by file. Short code fragments are fine (a signature, a call, one or two lines), but not the original's whole code: the learner still types it.",
};

export const hintAnswer = z.object({ text: z.string().min(20) });

/** Each file of the step as the learner has it now (null: not written yet). */
export type LearnerFiles = Map<string, string | null>;

/** The learner's code is cut here per file. */
const MAX_FILE = 8_000;

export interface HintInput extends LessonInput {
  level: HintLevel;
  /** Hints already given for this step, lowest level first. */
  earlier: Lesson["hints"];
  learnerFiles: LearnerFiles;
  /** What the last failing checks said ("label: message"). */
  failures: string[];
}

export function hintPrompt(input: HintInput): string {
  const files = [...input.learnerFiles]
    .map(([path, code]) => (code === null ? `## ${path}\n(not written yet)` : `## ${path}\n\`\`\`\n${code.length > MAX_FILE ? `${code.slice(0, MAX_FILE)}\n… (cut)` : code}\n\`\`\``))
    .join("\n\n");
  return `${stepContext(input)}

# What the learner wrote so far
${files || "(nothing yet)"}

# What the checks say
${input.failures.length > 0 ? input.failures.map((f) => `- ${f}`).join("\n") : "- (the checks haven't been run, or they all passed)"}

# Hints already given
${input.earlier.length > 0 ? input.earlier.map((h) => `- Hint ${h.level}: ${h.text}`).join("\n") : "- (none)"}

Write ${LEVELS[input.level]}
Build on the hints already given instead of repeating them. Talk to the learner ("you"). Never paste the original's code as a whole.
Answer as JSON: { "text": "<the hint, Markdown>" }.`;
}

export async function generateHint(client: AiClient, input: HintInput): Promise<string> {
  const result = await client.generate({ role: "lessons", system: HINT_SYSTEM, prompt: hintPrompt(input), schema: hintAnswer });
  return result.data.text;
}

/** The lesson with one more hint (replacing a hint of the same level). */
export function withHint(lesson: Lesson, level: HintLevel, text: string, now: Date): Lesson {
  const hints = [...lesson.hints.filter((h) => h.level !== level), { level, text, unlockedAt: now.toISOString() }].sort((a, b) => a.level - b.level);
  return { ...lesson, hints };
}

/** The next rung the learner can take: hints in order, 4 once the three are used. */
export function nextHintLevel(step: StepProgress | undefined): HintLevel | null {
  const used = step?.hintsUsed ?? [];
  const next = ([1, 2, 3] as const).find((level) => !used.includes(level));
  return next ?? null;
}

function withStep(progress: Progress, pathId: string, stepId: string, change: (step: StepProgress) => StepProgress): Progress {
  const path = progress.paths[pathId];
  if (!path) return progress;
  const step: StepProgress = path.steps[stepId] ?? { status: "available", attempts: 0, hintsUsed: [], revealed: false, timeSpentSec: 0 };
  return { ...progress, paths: { ...progress.paths, [pathId]: { ...path, steps: { ...path.steps, [stepId]: change(step) } } } };
}

/** A hint taken: counted once per level (design/03 hintsUsed). */
export function withHintUsed(progress: Progress, pathId: string, stepId: string, level: HintLevel): Progress {
  return withStep(progress, pathId, stepId, (step) => ({
    ...step,
    status: step.status === "available" || step.status === "locked" ? "in-progress" : step.status,
    hintsUsed: step.hintsUsed.includes(level) ? step.hintsUsed : [...step.hintsUsed, level].sort(),
  }));
}

/** The original revealed for this step (counted in the stats). */
export function withReveal(progress: Progress, pathId: string, stepId: string): Progress {
  return withStep(progress, pathId, stepId, (step) => ({ ...step, revealed: true }));
}

export interface FileChange {
  path: string;
  /** At R_k-1; null when the step creates the file. */
  before: string | null;
  /** At R_k; null when the step removes it. */
  after: string | null;
}

/** What the original changes in a step: each file between two reference tags, from git objects. */
export async function stepChanges(host: Host, workDir: string, before: string, after: string): Promise<FileChange[]> {
  const show = (tag: string, path: string) => host.git(workDir, ["show", `${tag}:${path}`]).catch(() => null);
  const paths = (await host.git(workDir, ["diff", "--name-only", before, after])).split("\n").filter(Boolean);
  const changes: FileChange[] = [];
  for (const path of paths) changes.push({ path, before: await show(before, path), after: await show(after, path) });
  return changes;
}
