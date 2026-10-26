// Step goals rewritten from their proven checks (#84, design/09 "Goals still miss contracts"). The
// planner writes goals before any check exists, so it can't know a parameter the checks pass, a
// route they call or the exact text they read. Once a step's checks are proven, one cheap call
// rewrites the goal so it names those contracts; the lesson's "What the checks expect" list stays
// the detailed version. When the rewrite fails, the planner's goal is kept.

import { z } from "zod";
import type { AiClient } from "../../ai/client.ts";
import type { CheckSource } from "../../learn/lesson.ts";
import type { Step } from "../../schemas/learning-path.ts";

export const GOAL_SYSTEM = `You edit one step of a learning path in KnYC, an app where developers rebuild a real codebase step by step until each step's checks pass.
You rewrite the step's goal so a learner who reads only the goal knows what the checks will call or read.`;

export const MAX_GOAL = 300;

export const goalAnswer = z.object({ goal: z.string().min(10).max(MAX_GOAL) });

/** The checks' code is cut here in total. */
const MAX_SOURCES = 12_000;

/**
 * `declarations`: how the original declares what the step introduces ("src/a.ts: export function
 * f(store: Store, maxTitleLength: number)"), so the goal uses its names, not ones the checks'
 * positional values suggest.
 */
export function goalPrompt(step: Pick<Step, "id" | "title" | "goal">, sources: CheckSource[], declarations: string[] = []): string {
  let left = MAX_SOURCES;
  const parts: string[] = [];
  for (const source of sources) {
    if (left <= 0) break;
    const code = source.code.length > left ? `${source.code.slice(0, left)}\n… (cut)` : source.code;
    left -= code.length;
    parts.push(`"${source.label}" runs ${source.file}:\n\`\`\`js\n${code}\n\`\`\``);
  }
  return `# Step ${step.id}: ${step.title}
Current goal: ${step.goal}
${
  declarations.length > 0
    ? `
# How the original declares what this step introduces
${declarations.map((d) => `- ${d}`).join("\n")}
`
    : ""
}
# Its checks (proven: they fail before the step and pass after it)
${parts.join("\n\n")}

Rewrite the goal, at most ${MAX_GOAL} characters:
- Keep what the step builds and keep it a goal (what works when the step is done), not instructions.
- Use the original's names for functions, classes and parameters (from the declarations above), not names guessed from the values the checks pass.
- Name what the checks rely on that the learner can't guess: exact function or class names with their parameters and order, constructor arguments (a store, a clock, a limit), routes and methods, status codes, exact response bodies or fields, text read from the output, environment variables.
- Leave out what any implementation would do anyway, and never describe the step's logic line by line.
Answer as JSON: { "goal": "<the new goal>" }.`;
}

/** The goal rewritten from the step's checks; throws when no valid answer came back. */
export async function goalFromChecks(client: AiClient, step: Pick<Step, "id" | "title" | "goal">, sources: CheckSource[], declarations: string[] = []): Promise<string> {
  const result = await client.generate({ role: "summaries", system: GOAL_SYSTEM, prompt: goalPrompt(step, sources, declarations), schema: goalAnswer });
  return result.data.goal.trim();
}
