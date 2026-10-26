// HTTP checks written by the AI (#88): for a step the planner marked "http", once the project's
// server starts at that step, the model writes requests with their expected status and body. They
// are proven like any check: they fail before the step and pass at it (design/02 ⑧). When the
// server doesn't start yet, or no HTTP check gets proven, the step falls back to generated tests.

import { z } from "zod";
import type { AiClient } from "../../ai/client.ts";
import type { HttpRequest } from "../../host/host.ts";
import type { HttpOutcome } from "../../sys/knyc-sys.ts";
import type { StepContext } from "./generated.ts";

export const HTTP_CHECKS_SYSTEM = `You write HTTP checks for KnYC, an app that teaches a codebase by having learners rebuild it step by step.
A check proves that one step is done: its requests are sent to the project's running server and must all get the expected answers after the step, and not before it.`;

export const httpAnswer = z.object({
  checks: z
    .array(
      z.object({
        label: z.string().min(5).max(80).describe("Shown to the learner: 'POST /notes returns 201'"),
        requests: z
          .array(
            z.object({
              method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
              path: z.string().startsWith("/"),
              body: z.unknown().optional().describe("JSON body, for POST / PUT / PATCH"),
              expect: z.object({
                status: z.number().int().min(100).max(599),
                jsonSubset: z.unknown().optional().describe("Fields the JSON answer must contain (a subset)"),
                bodyIncludes: z.array(z.string()).optional(),
              }),
            }),
          )
          .min(1)
          .max(5),
      }),
    )
    .max(3)
    .describe("1-3 checks; an empty list when the step adds nothing the server answers"),
  reasonIfNone: z.string().max(300).optional(),
});
export type HttpAnswer = z.infer<typeof httpAnswer>;

export interface HttpCandidate {
  label: string;
  requests: HttpRequest[];
}

export function httpChecksPrompt(ctx: StepContext, problems: string[] = []): string {
  return `Step ${ctx.step.id}: ${ctx.step.title}
Goal: ${ctx.step.goal}

The code this step adds (diff from the previous step):
\`\`\`diff
${ctx.diff}
\`\`\`

The server is started fresh for each check (empty in-memory data), then your requests are sent in order.

Rules:
- Only requests this step makes answer correctly; before the step they must fail (a missing route answers 404).
- Requests may build on each other within a check (create, then read it back).
- Expect exact status codes; in bodies, assert only fields the goal or the code fixes (no ids or dates that could differ, unless the code makes them predictable).
- Never depend on data another check created: each check starts with a fresh server.
${
  problems.length > 0
    ? `
Your previous checks were run and had these problems; write corrected checks:
${problems.map((p) => `- ${p}`).join("\n")}
`
    : ""
}`;
}

export async function askForHttpChecks(client: AiClient, ctx: StepContext, problems: string[]): Promise<HttpAnswer> {
  const result = await client.generate({ role: "lessons", system: HTTP_CHECKS_SYSTEM, prompt: httpChecksPrompt(ctx, problems), schema: httpAnswer });
  return result.data;
}

/** What went wrong with an HTTP candidate, for the model; undefined when it's proven. */
export function describeHttpProblem(label: string, atStep: HttpOutcome, before: HttpOutcome | null): string | undefined {
  if (atStep.status !== "pass") {
    const failed = atStep.requests.filter((r) => r.problem).map((r) => `${r.method} ${r.path}: ${r.problem}`);
    return `"${label}" fails after the step: ${[atStep.error, ...failed].filter(Boolean).join("; ")}`;
  }
  if (before && before.status === "pass") return `"${label}" already passes before the step: it doesn't prove the step`;
  return undefined;
}
