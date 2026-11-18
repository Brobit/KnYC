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
          .describe("The body of `async function ({ page, mountUrl }) { … }`: Playwright Page API calls; `assert` is node:assert/strict"),
        mount: z
          .string()
          .max(4000)
          .optional()
          .describe("When the app's page doesn't show the step's component yet: a TSX module rendering it into #root with sample props; the test opens it with page.goto(mountUrl)"),
      }),
    )
    .max(3)
    .describe("1-3 checks; an empty list when the step changes nothing a browser can see"),
  reasonIfNone: z.string().max(300).optional(),
});
export type UiAnswer = z.infer<typeof uiAnswer>;

export interface UiCandidate {
  label: string;
  /** The test module first (`.knyc-checks/s05-ui-1-1.ui.mjs`), then its mount page and module
   * when it has one; paths in the working copy. */
  files: { path: string; code: string }[];
}

/**
 * How a framework mounts one component alone: React in a TSX module (#92), Vue in a TS module
 * (#94), Next.js as a page of the app (#93), Angular as the app's main.ts while it has none (#95).
 */
export type MountKind = "react" | "vue" | "next-app" | "angular-main";

/**
 * The files of a candidate: the test, and the page that mounts one component alone (#92). With
 * Vite, an HTML page next to the test loads the mount module (`.mount.tsx`, `.mount.ts` for Vue);
 * with Next.js (#93), the mount module is a page of its own,
 * `<package>/app/knyc-checks/<name>/page.tsx`, served at /knyc-checks/<name>.
 */
export function uiCandidateFiles(base: string, label: string, body: string, mount?: string, kind: MountKind = "react", root = "."): UiCandidate["files"] {
  const name = base.slice(base.lastIndexOf("/") + 1);
  // Angular (#95): `ng serve` builds only src/main.ts. Until the app has one, the mount is it, and
  // its page is the app's own ("/", whose index.html holds <app-root>).
  if (kind === "angular-main" && mount?.trim()) {
    return [
      { path: `${base}.ui.mjs`, code: uiTestModule(label, body, "/") },
      { path: `${root === "." ? "" : `${root}/`}src/main.ts`, code: `// KnYC mount page for: ${label.replace(/\n/g, " ")}\n${mount.trim()}\n` },
    ];
  }
  if (kind === "next-app" && mount?.trim()) {
    const page = `${root === "." ? "" : `${root}/`}app/knyc-checks/${name}/page.tsx`;
    return [
      { path: `${base}.ui.mjs`, code: uiTestModule(label, body, `/knyc-checks/${name}`) },
      { path: page, code: `"use client";\n// KnYC mount page for: ${label.replace(/\n/g, " ")}\n${mount.trim().replace(/^["']use client["'];?\s*/, "")}\n` },
    ];
  }
  const test = { path: `${base}.ui.mjs`, code: uiTestModule(label, body) };
  if (!mount?.trim()) return [test];
  const module = `${name}.mount.${kind === "vue" ? "ts" : "tsx"}`;
  return [
    test,
    { path: `${base}.html`, code: `<!doctype html>\n<html><head><title>${label.replace(/[<&]/g, "")}</title></head>\n<body><div id="root"></div><script type="module" src="./${module}"></script></body></html>\n` },
    { path: `${base.slice(0, base.lastIndexOf("/") + 1)}${module}`, code: `// KnYC mount page for: ${label.replace(/\n/g, " ")}\n${mount.trim()}\n` },
  ];
}

/** What the prompt asks a mount module to be, by framework. */
const MOUNT_MODULE: Record<MountKind, string> = {
  react: 'a complete TSX module that renders the step\'s component into document.getElementById("root")',
  vue: 'a complete TypeScript module that mounts the step\'s component on "#root" with createApp (import { createApp, h } from "vue"; a render function passes the props; install createPinia() and a router with createMemoryHistory() when the component uses a store, RouterLink or RouterView)',
  "next-app": 'a complete TSX module whose default export is a page component (a Next.js page, already marked "use client") that renders the step\'s component',
  "angular-main":
    'the app\'s src/main.ts for this check (the app has none yet): a standalone component with selector "app-root" whose template renders the step\'s component, started with bootstrapApplication (add provideRouter([]) to its providers when the component uses routerLink)',
};

/** The test module around the model's body: what the runner imports and calls with a page. */
export function uiTestModule(label: string, body: string, mountUrl?: string): string {
  const indented = body
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : ""))
    .join("\n");
  // The specifier is text of the generated module (it runs on the learner's Node.js), not an import
  // of core, which stays browser-safe.
  return `// KnYC UI check: ${label.replace(/\n/g, " ")}
import assert from ${JSON.stringify("node:assert/strict")};

${
    // A Next.js mount page is a route of the app (#93): its URL is known here.
    mountUrl
      ? `export default async function ({ page }) {
  const mountUrl = ${JSON.stringify(mountUrl)};
${indented}
}`
      : `export default async function ({ page, mountUrl }) {
${indented}
}`
  }
`;
}

/**
 * `mountImports`: source file → its import path from the checks folder, for mount modules.
 * `appShown`: false when the app's entry point doesn't exist yet at this step (its page is empty).
 * `kind`: what a mount module is (a React or Vue module rendering into #root, a Next.js page).
 */
export function uiChecksPrompt(ctx: StepContext, problems: string[] = [], mountImports: Map<string, string> = new Map(), appShown = true, kind: MountKind = "react"): string {
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
Each check is the body of \`async function ({ page, mountUrl }) { … }\`, run in a fresh browser page against the project's frontend, started fresh for each check.
${
  mountImports.size > 0
    ? `
When the app's own page doesn't show this step's work yet (its root component or entry point comes in a later step), also write \`mount\`: ${
MOUNT_MODULE[kind]} with sample props (record callbacks on window to check them; for a hook, a small component that calls it and shows what it returns, with buttons for its actions), and open it with \`await page.goto(mountUrl)\`.${appShown ? "" : " The app's entry point comes in a later step: its own page is empty at this step, so every check here uses a mount page."} Import the project's code from these paths:
${[...mountImports].map(([file, path]) => `- ${file}: "${path}"`).join("\n")}
`
    : ""
}
Rules:
- Start with \`await page.goto("/")\` (the base URL is the frontend's server), or \`await page.goto(mountUrl)\` for a mount page.
- Find elements as a user would: page.getByRole, getByLabel, getByPlaceholder, getByText. No CSS classes or ids unless the code sets them for that purpose.
- Actions wait up to 5 s for their element. Wait for what should appear with \`await locator.waitFor()\`; compare values with \`assert\` (\`assert.equal(await locator.count(), 2)\`, \`assert.match(await locator.textContent(), /2 notes/)\`).
- Only what this step makes visible or makes work: before the step the test must fail.
- In the test: no page.waitForTimeout, screenshots, console.log or imports; \`page\`, \`mountUrl\` and \`assert\` are all there is.
- The test is plain JavaScript (an .mjs module): no type annotations, \`as\` casts or \`!\`; only the mount module is TSX. Code passed to page.evaluate runs in the browser, also as plain JavaScript.
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

export async function askForUiChecks(client: AiClient, ctx: StepContext, problems: string[], mountImports?: Map<string, string>, appShown?: boolean, kind?: MountKind): Promise<UiAnswer> {
  const result = await client.generate({ role: "lessons", system: UI_CHECKS_SYSTEM, prompt: uiChecksPrompt(ctx, problems, mountImports, appShown, kind), schema: uiAnswer });
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
