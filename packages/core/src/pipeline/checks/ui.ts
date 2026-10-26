// UI checks written by the AI (#89, design/06 H4): for a step the plan marks "ui", once the
// project's frontend starts at that step, the model writes Playwright tests that drive it in
// headless Chromium. They are proven like any check: they fail before the step and pass at it
// (design/02 ⑧). When the frontend doesn't start, Chromium isn't downloaded, or no UI test gets
// proven, the step falls back to generated tests.

import { z } from "zod";
import type { AiClient } from "../../ai/client.ts";
import type { UiOutcome } from "../../sys/knyc-sys.ts";
import type { StepContext } from "./generated.ts";

export const UI_CHECKS_SYSTEM = `You write UI checks for KnYC, an app that teaches a codebase by having learners rebuild it step by step.
A check proves that one step is done: a test drives the project's running frontend in a real browser (Playwright, headless Chromium) and must pass after the step, and fail before it.`;

export const uiAnswer = z.object({
  checks: z
    .array(
      z.object({
        label: z.string().min(5).max(80).describe("Shown to the learner: 'Adding a note shows it in the list'"),
        body: z
          .string()
          .min(20)
          .max(4000)
          .describe("The body of `async function ({ page }) { … }`: Playwright Page API calls; `assert` is node:assert/strict"),
      }),
    )
    .max(3)
    .describe("1-3 checks; an empty list when the step changes nothing a browser can see"),
  reasonIfNone: z.string().max(300).optional(),
});
export type UiAnswer = z.infer<typeof uiAnswer>;

export interface UiCandidate {
  label: string;
  /** The test module's path in the working copy (`.knyc-checks/s05-ui-1.ui.mjs`). */
  file: string;
  code: string;
}

/** The test module around the model's body: what the runner imports and calls with a page. */
export function uiTestModule(label: string, body: string): string {
  const indented = body
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : ""))
    .join("\n");
  // The specifier is text of the generated module (it runs on the learner's Node.js), not an import
  // of core, which stays browser-safe.
  return `// KnYC UI check: ${label.replace(/\n/g, " ")}
import assert from ${JSON.stringify("node:assert/strict")};

export default async function ({ page }) {
${indented}
}
`;
}

export function uiChecksPrompt(ctx: StepContext, problems: string[] = []): string {
  return `Step ${ctx.step.id}: ${ctx.step.title}
Goal: ${ctx.step.goal}

The code this step adds (diff from the previous step):
\`\`\`diff
${ctx.diff}
\`\`\`
${
  ctx.context.size > 0
    ? `
Files it uses, as they are at this step:
${[...ctx.context].map(([file, code]) => `--- ${file}\n${code}`).join("\n")}
`
    : ""
}
Each check is the body of \`async function ({ page }) { … }\`, run in a fresh browser page against the project's frontend, started fresh for each check.

Rules:
- Start with \`await page.goto("/")\`: the base URL is the frontend's server.
- Find elements as a user would: page.getByRole, getByLabel, getByPlaceholder, getByText. No CSS classes or ids unless the code sets them for that purpose.
- Actions wait up to 5 s for their element. Wait for what should appear with \`await locator.waitFor()\`; compare values with \`assert\` (\`assert.equal(await locator.count(), 2)\`, \`assert.match(await locator.textContent(), /2 notes/)\`).
- Only what this step makes visible or makes work: before the step the test must fail.
- No page.waitForTimeout, screenshots, console.log, or imports: \`page\` and \`assert\` are all there is.
- Never depend on data another check created: each check starts with a fresh page and server.
${
  problems.length > 0
    ? `
Your previous checks were run and had these problems; write corrected checks:
${problems.map((p) => `- ${p}`).join("\n")}
`
    : ""
}`;
}

export async function askForUiChecks(client: AiClient, ctx: StepContext, problems: string[]): Promise<UiAnswer> {
  const result = await client.generate({ role: "lessons", system: UI_CHECKS_SYSTEM, prompt: uiChecksPrompt(ctx, problems), schema: uiAnswer });
  return result.data;
}

/** What went wrong with a UI candidate, for the model; undefined when it's proven. */
export function describeUiProblem(label: string, atStep: UiOutcome, before: UiOutcome | null): string | undefined {
  if (atStep.status !== "pass") {
    const test = atStep.tests.find((t) => t.status !== "pass");
    const detail = test
      ? [test.error, test.pageErrors.length > 0 ? `the page logged: ${test.pageErrors.join("; ")}` : "", test.snapshot ? `the page showed:\n${test.snapshot}` : ""].filter(Boolean).join("\n")
      : (atStep.error ?? atStep.status);
    return `"${label}" fails after the step: ${detail}`;
  }
  if (before && before.status === "pass") return `"${label}" already passes before the step: it doesn't prove the step`;
  return undefined;
}
