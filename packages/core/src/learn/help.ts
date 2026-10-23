// AI help inside a step (#64, design/04 §7): "Explain this failure" on a failing check, and the
// step chat. Both see the step (stepContext), the learner's code for it and, for a failure, the
// real error (design/08, lesson 3: send back the real error). Answers are kept in the step's
// lesson (`chat`), so they stay with the step. What goes in has been through the secret guard
// (the desktop's `workspace_read_for_ai`), like the analysis.

import { z } from "zod";
import type { AiClient } from "../ai/client.ts";
import type { Lesson } from "../schemas/lesson.ts";
import type { LearnerFiles } from "./hints.ts";
import { stepContext, type LessonInput } from "./lesson.ts";

export const HELP_SYSTEM = `You are the teacher in KnYC, an app where developers learn a real codebase by rebuilding it one step at a time until the step's checks pass.
You answer the learner inside a step: in plain words, short, about their code and this step. You know the original code of the step, but you never hand it over: the learner writes it.`;

export const helpAnswer = z.object({ text: z.string().min(1) });

/** The learner's code is cut here per file, the error output in total. */
const MAX_FILE = 8_000;
const MAX_OUTPUT = 6_000;
/** Chat turns sent back with a new question. */
const HISTORY = 12;

function learnerCode(files: LearnerFiles): string {
  const shown = [...files].map(([path, code]) =>
    code === null ? `## ${path}\n(not written yet, or not shareable)` : `## ${path}\n\`\`\`\n${code.length > MAX_FILE ? `${code.slice(0, MAX_FILE)}\n… (cut)` : code}\n\`\`\``,
  );
  return shown.join("\n\n") || "(nothing yet)";
}

export interface ExplainInput extends LessonInput {
  /** The check's label: what it proves. */
  check: string;
  /** What the check printed: the failure message first, then the output. */
  failure: string;
  learnerFiles: LearnerFiles;
}

export function explainPrompt(input: ExplainInput): string {
  const failure = input.failure.length > MAX_OUTPUT ? `${input.failure.slice(0, MAX_OUTPUT)}\n… (cut)` : input.failure;
  return `${stepContext(input)}

# What the learner wrote so far
${learnerCode(input.learnerFiles)}

# The failing check: "${input.check}"
\`\`\`
${failure}
\`\`\`

Explain this failure to the learner in plain words, in 3 to 8 sentences or a few bullets (Markdown):
- what the error means, and the line or file it points at when it does;
- why their code makes it happen, compared with what the check expects;
- what to look at to fix it.
Don't write the fix for them and never paste the original's code. Answer as JSON: { "text": "<the explanation>" }.`;
}

export interface ChatInput extends LessonInput {
  /** The lesson the learner read (its explanation). */
  lesson: string;
  learnerFiles: LearnerFiles;
  history: Lesson["chat"];
  question: string;
}

export function chatPrompt(input: ChatInput): string {
  const history = input.history.slice(-HISTORY);
  return `${stepContext(input)}

# The lesson the learner read
${input.lesson}

# What the learner wrote so far
${learnerCode(input.learnerFiles)}

# The conversation so far
${history.length > 0 ? history.map((m) => `${m.role === "user" ? "Learner" : "You"}: ${m.content}`).join("\n\n") : "(none)"}

# The learner asks
${input.question}

Answer in Markdown, short and concrete, about this step and their code. You may explain concepts, APIs and errors, and point at what to change; don't write the step's code for them and never paste the original's code. Answer as JSON: { "text": "<your answer>" }.`;
}

export async function explainFailure(client: AiClient, input: ExplainInput): Promise<string> {
  return (await client.generate({ role: "lessons", system: HELP_SYSTEM, prompt: explainPrompt(input), schema: helpAnswer })).data.text;
}

export async function answerQuestion(client: AiClient, input: ChatInput): Promise<string> {
  return (await client.generate({ role: "lessons", system: HELP_SYSTEM, prompt: chatPrompt(input), schema: helpAnswer })).data.text;
}

/** The lesson with an exchange added to the step chat. */
export function withChat(lesson: Lesson, question: string, answer: string, now: Date): Lesson {
  const at = now.toISOString();
  return { ...lesson, chat: [...lesson.chat, { role: "user", content: question, at }, { role: "assistant", content: answer, at }] };
}
