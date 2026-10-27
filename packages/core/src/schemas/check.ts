import { z } from "zod";
import { id, isoDate } from "./common.ts";

export const server = z.object({
  start: z.string().min(1),
  root: z.string(),
  port: z.number().int().min(1).max(65535),
  readyPath: z.string().startsWith("/"),
  env: z.record(z.string(), z.string()).optional(),
  /** Environment variable the server reads its port from (the profile's; default PORT). */
  portEnv: z.string().optional(),
  /** Arguments added to start, "{port}" replaced (Vite's " -- --port {port} --strictPort", #92). */
  portArgs: z.string().optional(),
  /** Start on `port` itself: a backend the frontend's dev proxy expects there (#92). */
  fixedPort: z.boolean().optional(),
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
  /** UI tests in headless Chromium against the running frontend (#89); like a generated test's
   * files, they are copied into the workspace only while they run. */
  z.object({
    kind: z.literal("ui"),
    server,
    files: z.array(z.string()).min(1),
    /** Started before the frontend: the original backend its dev proxy calls (#92). */
    companions: z.array(server).optional(),
  }),
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

/** One run of one check in the learner's workspace; `.knyc/runs/<pathId>/<stepId>.jsonl`, one per line. */
export const checkRun = z.object({
  checkId: id,
  at: isoDate,
  status: z.enum(["pass", "fail", "error", "timeout"]),
  durationMs: z.number().min(0),
  /** stdout + stderr, truncated to 64 KB. */
  output: z.string(),
  failures: z
    .array(
      z.object({
        message: z.string(),
        expected: z.string().optional(),
        actual: z.string().optional(),
        file: z.string().optional(),
        line: z.number().int().optional(),
      }),
    )
    .default([]),
  /** A UI check's page when it failed, as a JPEG data URL (#89); not kept in the runs file. */
  screenshot: z.string().optional(),
});
export type CheckRun = z.infer<typeof checkRun>;

export function isValidated(c: Check): boolean {
  return c.validation?.failsOnPrevious === true && c.validation.passesOnReference === true;
}
