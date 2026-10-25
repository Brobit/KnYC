// The lesson of a step (#62, design/02 ⑨, decision D3): generated the first time the learner opens
// the step, then kept in `.knyc/lessons/`. The model sees the original's change for the step (the
// reference diff) and the step's checks, so it can state every contract they rely on (names,
// signatures, constructor parameters, exact responses, #66), and is told not to hand over the code
// itself: rebuilding it is the learner's job (hints and reveal come later, #63).

import { z } from "zod";
import type { AiClient } from "../ai/client.ts";
import type { Summaries } from "../pipeline/summaries.ts";
import type { Check } from "../schemas/check.ts";
import type { ModelRef } from "../schemas/common.ts";
import type { LearningPath } from "../schemas/learning-path.ts";
import { lesson as lessonSchema, type Lesson } from "../schemas/lesson.ts";

export const LESSON_SYSTEM = `You are the teacher in KnYC, an app where developers learn a real codebase by rebuilding it from an empty folder, one step at a time, until the step's checks pass.
You write the lesson for one step: what to build, why, and how it fits the project. You know the original code of the step, but you never hand it over: the learner writes it.`;

export const lessonAnswer = z.object({
  /** Markdown, 150–350 words. */
  explanation: z.string().min(80),
  /** One sentence: where this step's code sits in the architecture. */
  architectureNote: z.string().min(1),
});
export type LessonAnswer = z.infer<typeof lessonAnswer>;

/** The reference diff is cut here: enough for a step, bounded for the prompt. */
const MAX_DIFF = 16_000;
/** The same for the checks' code, all files together. */
const MAX_CHECKS = 12_000;

/** One check of the step as the teacher sees it: what it's called and the test code it runs. */
export interface CheckSource {
  label: string;
  /** The generated test file, or the project's test file that holds the test. */
  file: string;
  code: string;
}

export interface LessonInput {
  projectName: string;
  path: LearningPath;
  stepId: string;
  summaries: Summaries;
  /** The original's change for this step: `git diff R_(k-1) R_k`. */
  diff: string;
  /**
   * The step's checks. Without them the lesson can't know what they rely on beyond the goal: the
   * alpha run (#66, design/09) found a clock in a constructor, a `/health` body and a startup log
   * line that only the checks named.
   */
  checks?: CheckSource[];
}

const TEST_TITLE = /\b(?:it|test)\s*\(\s*(["'`])(.+?)\1/g;

/**
 * The code behind a step's checks: a generated check's own file, or the project's test file whose
 * test the check selects (its filter is the full name, e.g. "NotesStore filters by tag", ending
 * with the `it(…)` title). Each file once.
 */
export function checkSources(checks: Check[], generated: Map<string, string>, testFiles: Map<string, string>): CheckSource[] {
  const sources: CheckSource[] = [];
  const seen = new Set<string>();
  const add = (label: string, file: string, code: string | undefined) => {
    if (code === undefined || seen.has(file)) return;
    seen.add(file);
    sources.push({ label, file, code });
  };
  for (const check of checks) {
    if (check.spec.kind !== "test") continue;
    if (check.origin === "generated") {
      for (const file of check.spec.files) add(check.label, file, generated.get(file));
      continue;
    }
    for (const [file, code] of testFiles) {
      const titles = [...code.matchAll(TEST_TITLE)].map((m) => m[2]!);
      if (check.spec.filter.some((name) => titles.some((title) => name === title || name.endsWith(` ${title}`)))) add(check.label, file, code);
    }
  }
  return sources;
}

function checksSection(checks: CheckSource[]): string {
  let left = MAX_CHECKS;
  const parts: string[] = [];
  for (const check of checks) {
    if (left <= 0) {
      parts.push("… (more checks, cut)");
      break;
    }
    const code = check.code.length > left ? `${check.code.slice(0, left)}\n… (cut)` : check.code;
    left -= code.length;
    parts.push(`"${check.label}" runs ${check.file}:\n\`\`\`js\n${code}\n\`\`\``);
  }
  return parts.join("\n\n");
}

/** The project, the path so far, the step and the original's change: what lessons and hints start from. */
export function stepContext(input: LessonInput): string {
  const { path, summaries } = input;
  const index = path.steps.findIndex((s) => s.id === input.stepId);
  const step = path.steps[index]!;
  const milestone = path.milestones.find((m) => m.stepIds.includes(step.id));
  const files = new Set(step.introduces.map((u) => u.unit.split("#")[0]!));
  const roles = summaries.files.filter((f) => files.has(f.path));
  const diff = input.diff.length > MAX_DIFF ? `${input.diff.slice(0, MAX_DIFF)}\n… (cut)` : input.diff;

  return `# Project
${input.projectName}: ${summaries.project.purpose}
Architecture: ${summaries.project.architecture}

# Path so far
${path.steps
  .slice(0, index)
  .map((s) => `- ${s.id} ${s.title} (done)`)
  .join("\n") || "- (this is the first step)"}

# This step: ${step.id} "${step.title}"${milestone ? ` (milestone "${milestone.title}": ${milestone.summary})` : ""}
Goal: ${step.goal}
Concepts: ${step.concepts.join(", ") || "-"}
Files: ${[...files].join(", ")}
${roles.map((f) => `- ${f.path}: ${f.role}. ${f.summary}`).join("\n")}

# The original's change for this step (for you only)
\`\`\`diff
${diff}
\`\`\`${
    input.checks && input.checks.length > 0
      ? `

# The checks the learner's code must pass (for you only)
${checksSection(input.checks)}`
      : ""
  }`;
}

export function lessonPrompt(input: LessonInput): string {
  return `${stepContext(input)}

Write the lesson as JSON:
- "explanation": Markdown, 150 to 350 words, talking to the learner ("you"). Say what to build and why, which files to create or change, and what each piece must do. Use the exact names of exported functions, classes, routes and files from the change, since the checks call them. Explain the concepts the step introduces in a sentence or two each.
- End the explanation with a "**What the checks expect**" list: every contract the checks rely on that the learner can't guess from the goal. Exact signatures and parameter order, constructor parameters (a clock or a store passed in), status codes, exact response bodies, text the checks read from the output, environment variables. Say what, not how: never the step's logic.
- Never paste the original's code or a near copy of it. A snippet of at most 3 lines is fine only to show how a library API is called, never the step's own logic.
- "architectureNote": one sentence on where this code fits ("Used by …", "Called from …").`;
}

export async function generateLesson(client: AiClient, input: LessonInput, options: { model: ModelRef; now?: Date }): Promise<Lesson> {
  const result = await client.generate({ role: "lessons", system: LESSON_SYSTEM, prompt: lessonPrompt(input), schema: lessonAnswer });
  return lessonSchema.parse({
    schemaVersion: 1,
    stepId: input.stepId,
    generatedWith: options.model,
    at: (options.now ?? new Date()).toISOString(),
    explanation: result.data.explanation,
    architectureNote: result.data.architectureNote,
    hints: [],
    chat: [],
  });
}
