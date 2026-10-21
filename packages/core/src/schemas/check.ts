import { z } from "zod";
import { id, isoDate } from "./common.ts";

export const server = z.object({
  start: z.string().min(1),
  root: z.string(),
  port: z.number().int().min(1).max(65535),
  readyPath: z.string().startsWith("/"),
  env: z.record(z.string(), z.string()).optional(),
});

export const httpExpectation = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  path: z.string().startsWith("/"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  expect: z.object({
    status: z.number().int().min(100).max(599),
    jsonSubset: z.unknown().optional(),
    bodyIncludes: z.array(z.string()).optional(),
  }),
});
export type HttpExpectation = z.infer<typeof httpExpectation>;

export const checkSpec = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("test"),
    root: z.string(),
    runner: z.enum(["jest", "vitest", "pytest", "go", "dotnet", "other"]),
    command: z.string().min(1),
    /** Test names / files to select. */
    filter: z.array(z.string()).default([]),
    /** Generated test files, copied into the workspace only while the check runs. */
    files: z.array(z.string()).default([]),
  }),
  z.object({ kind: z.literal("http"), server, requests: z.array(httpExpectation).min(1) }),
  z.object({
    kind: z.literal("command"),
    command: z.string().min(1),
    stdin: z.string().optional(),
    expect: z
      .object({
        exitCode: z.number().int().optional(),
        stdoutIncludes: z.array(z.string()).optional(),
        stdoutRegex: z.string().optional(),
      })
      .refine((e) => Object.values(e).some((v) => v !== undefined), "expect needs at least one condition"),
  }),
  z.object({ kind: z.literal("build"), root: z.string(), command: z.string().min(1) }),
  z.object({
    kind: z.literal("docker"),
    context: z.string(),
    dockerfile: z.string(),
    run: z.object({ port: z.number().int(), healthPath: z.string().startsWith("/") }).optional(),
  }),
]);
export type CheckSpec = z.infer<typeof checkSpec>;

/** `.knyc/checks/<pathId>/<checkId>.json` */
export const check = z.object({
  schemaVersion: z.literal(1),
  id,
  stepId: id,
  /** Shown to the learner: "POST /users returns 201". */
  label: z.string().min(1),
  origin: z.enum(["repo", "generated"]),
  timeoutMs: z.number().int().positive().default(60_000),
  spec: checkSpec,
  /** Red → green proof (design 02 ⑧). Absent until validated. */
  validation: z
    .object({ failsOnPrevious: z.boolean(), passesOnReference: z.boolean(), at: isoDate })
    .optional(),
});
export type Check = z.infer<typeof check>;

export function isValidated(c: Check): boolean {
  return c.validation?.failsOnPrevious === true && c.validation.passesOnReference === true;
}
