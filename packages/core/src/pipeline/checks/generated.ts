// Stage ⑧, part 2 (design/02): checks written by the AI for steps the project's tests don't
// cover. They use Node's built-in test runner on the compiled code, so they need no extra
// dependency. Each one must fail before its step, pass at its step, and pass at the last step.

import { z } from "zod";
import type { AiClient } from "../../ai/client.ts";
import { joinPath, type Host } from "../../host/host.ts";
import type { Step } from "../../schemas/learning-path.ts";
import { runCommand, type CheckOutcome } from "../../sys/knyc-sys.ts";

export const CHECKS_DIR = ".knyc-checks";

export const CHECKS_SYSTEM = `You write automated checks for KnYC, an app that teaches a codebase by having learners rebuild it step by step.
A check proves that one step is done: it must FAIL on the code before the step and PASS on the code after it.
Write small, deterministic tests with Node's built-in test runner. Only test behavior the step adds.`;

export const generatedAnswer = z.object({
  checks: z
    .array(
      z.object({
        label: z.string().min(5).max(80).describe("Shown to the learner: 'POST /notes returns 201'"),
        code: z.string().min(20).describe("A complete ESM test file (node:test, node:assert/strict)"),
      }),
    )
    .max(3)
    .describe("1-3 checks; an empty list when the step adds nothing observable at runtime (types only)"),
  reasonIfNone: z.string().max(300).optional(),
});
export type GeneratedAnswer = z.infer<typeof generatedAnswer>;

export interface StepContext {
  step: Step;
  /** `git diff` of the step's source changes. */
  diff: string;
  /** Source file → specifier to import its compiled code from the checks folder. */
  importPaths: Map<string, string>;
  /** Package dependencies the tests may import (e.g. express). */
  dependencies: string[];
  /**
   * Source file → what it exports at this step ("class LinksStore (methods: get, save…)").
   * Without it the model guesses names of code added in earlier steps.
   */
  exports: Map<string, string[]>;
  /** Full source, at this step, of the local files the step's changed files import. */
  context: Map<string, string>;
}

export function checksPrompt(ctx: StepContext, problems: string[] = []): string {
  return `Step ${ctx.step.id}: ${ctx.step.title}
Goal: ${ctx.step.goal}

The code this step adds (diff from the previous step):
\`\`\`diff
${ctx.diff}
\`\`\`

What each module exports at this step (use these exact names; nothing else exists):
${[...ctx.exports].map(([src, names]) => `- ${src}: ${names.join("; ") || "nothing"}`).join("\n")}
${[...ctx.context]
  .map(([src, code]) => `\nSource of ${src}, which the new code uses:\n\`\`\`ts\n${code}\n\`\`\``)
  .join("")}
Rules for each check file:
- ESM JavaScript, run with \`node --test <file>\` from the project root after the project is built.
- Use only node:test, node:assert/strict, global fetch, and these packages if useful: ${ctx.dependencies.join(", ") || "none"}.
- Import the project's code from its compiled output, with exactly these specifiers:
${[...ctx.importPaths].map(([src, spec]) => `  - ${src} → "${spec}"`).join("\n")}
- Before this step, the modules or functions it adds don't exist: the check must fail then (a failing import is fine).
- Test behavior: call the code and assert on what it returns or does. A check that only imports a module, or only
  checks that something exists or is a function, proves nothing. If the step only adds types or nothing callable,
  return no checks and say why.
- Use only the public API: exported names, constructor arguments, methods and what they return. Never read or set
  an object's internal fields (no \`store.now = …\`): the learner may name them differently. To control time or
  randomness, pass it in the way the code allows (a constructor parameter), or don't assert on it.
- Servers: listen on port 0, read the port from server.address(), and close them at the end. To start the
  project's own entry point as a process, first get a free port (listen on 0 with node:net, read it, close),
  pass it through PORT, and wait until fetch succeeds; never use a fixed port, and don't depend on the exact
  text the program prints unless the goal states it.
- No timers longer than 2 seconds, no network access outside localhost, no files written.
${
  problems.length > 0
    ? `
Your previous checks were run and had these problems; write corrected checks:
${problems.map((p) => `- ${p}`).join("\n")}
`
    : ""
}`;
}

export interface CandidateCheck {
  label: string;
  code: string;
  /** Path relative to the working copy, e.g. ".knyc-checks/s05-1.test.mjs". */
  file: string;
}

/** Writes a check into the working copy and runs it. */
export async function runCandidate(host: Host, workDir: string, check: CandidateCheck, timeoutMs = 60_000): Promise<CheckOutcome> {
  await host.writeFile(joinPath(workDir, check.file), check.code);
  // PORT=0: a server started by the project's own entry point gets a free port, never a busy one.
  return runCommand(host, workDir, `node --test ${check.file}`, { timeoutMs, env: { PORT: "0" } });
}

const ERROR_LINE = /error|assert|expected|actual|received|not ok|cannot|does not|undefined|is not a function|ECONN|timed out/i;

/**
 * The lines that explain a failure. Node's runner prints the real error first and a long summary
 * after, so the tail alone hides the cause: error-looking lines come first, then the tail.
 */
export function failureExcerpt(outcome: CheckOutcome, max = 25): string {
  const lines = `${outcome.run?.stdout ?? ""}\n${outcome.run?.stderr ?? ""}\n${outcome.error ?? ""}`
    .split("\n")
    .map((l) => l.replace(/^#\s?/, "").trimEnd())
    .filter((l) => l.trim() && !/^\s+at\s/.test(l));
  const important = lines.filter((l) => ERROR_LINE.test(l));
  const picked = [...new Set([...important.slice(0, max - 5), ...lines.slice(-5)])];
  return picked.slice(0, max).join("\n");
}

export interface Validation {
  check: CandidateCheck;
  passesAtStep: boolean;
  failsBefore: boolean;
  problem?: string;
}

/** What went wrong with a candidate, phrased for the model. */
export function describeProblem(label: string, atStep: CheckOutcome, before: CheckOutcome | null): string | undefined {
  if (atStep.status !== "pass") {
    return `"${label}" fails on the code right after the step, so it's wrong. Output:\n${failureExcerpt(atStep)}`;
  }
  if (before && before.status === "pass") {
    return `"${label}" also passes on the code before the step, so it doesn't test what the step adds`;
  }
  return undefined;
}

/** Asks for checks and parses the answer (one AI call; validation is done by the caller). */
export async function askForChecks(client: AiClient, ctx: StepContext, problems: string[]): Promise<GeneratedAnswer> {
  const result = await client.generate({
    role: "lessons",
    system: CHECKS_SYSTEM,
    prompt: checksPrompt(ctx, problems),
    schema: generatedAnswer,
  });
  return result.data;
}
