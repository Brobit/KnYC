import { z } from "zod";
import type { Host, SysRequest } from "../host/host.ts";
import { formatIssues } from "../schemas/documents.ts";

// Shapes of the JSON the knyc-sys steps return (crates/knyc-sys, or the same crates called by the
// desktop app). Only the fields the pipeline reads are listed; extra fields are allowed so Rust can
// grow without breaking TS.

const secretLine = z.object({ path: z.string(), line: z.number().int(), kind: z.string() });

export const scanSchema = z.looseObject({
  root: z.string(),
  hash: z.string(),
  languages: z.array(z.object({ id: z.string(), files: z.number(), loc: z.number() })),
  frameworks: z.array(z.object({ profileId: z.string(), version: z.string().nullable(), root: z.string() })),
  testRunners: z.array(z.object({ runner: z.string(), root: z.string() })),
  packages: z.array(z.looseObject({ root: z.string(), dependencies: z.record(z.string(), z.string()) })).default([]),
  commands: z.array(
    z.object({
      root: z.string(),
      install: z.string().nullable(),
      build: z.string().nullable(),
      test: z.string().nullable(),
      run: z.string().nullable(),
    }),
  ),
  toolchains: z.array(z.object({ id: z.string(), required: z.string(), found: z.string().nullable() })).default([]),
  files: z.array(z.object({ path: z.string(), bytes: z.number(), lines: z.number(), notForAi: z.string().optional() })),
  excluded: z.array(z.object({ path: z.string(), reason: z.string() })),
  secretLines: z.array(secretLine),
});
export type Scan = z.infer<typeof scanSchema>;

export const graphSymbolSchema = z.object({
  name: z.string(),
  kind: z.string(),
  exported: z.boolean(),
  startLine: z.number().int(),
  endLine: z.number().int(),
});

export const graphFileSchema = z.object({
  path: z.string(),
  language: z.string(),
  loc: z.number(),
  test: z.boolean(),
  parseErrors: z.boolean(),
  imports: z.array(
    z.object({
      specifier: z.string(),
      resolved: z.string().optional(),
      package: z.string().optional(),
      names: z.array(z.string()),
      typeOnly: z.boolean(),
      reexport: z.boolean(),
    }),
  ),
  exports: z.array(z.string()),
  symbols: z.array(graphSymbolSchema),
});
export type GraphFile = z.infer<typeof graphFileSchema>;

export const graphSchema = z.object({
  files: z.array(graphFileSchema),
  edges: z.array(z.object({ from: z.string(), to: z.string(), typeOnly: z.boolean() })),
  symbolEdges: z.array(z.tuple([z.string(), z.string()])),
  cycles: z.array(z.array(z.string())),
  layers: z.array(z.array(z.string())),
  external: z.record(z.string(), z.array(z.string())),
  unresolved: z.array(z.object({ file: z.string(), specifier: z.string() })),
});
export type Graph = z.infer<typeof graphSchema>;

export class KnycSysError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnycSysError";
  }
}

/** Runs a knyc-sys step through the host and validates its result with `schema`. */
async function knycSys<S extends z.ZodType>(host: Host, request: SysRequest, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await host.sys(request));
  if (!parsed.success) {
    throw new KnycSysError(`unexpected knyc-sys ${request.op} output:\n- ${formatIssues(parsed.error).join("\n- ")}`);
  }
  return parsed.data;
}

/** Static scan; `toolchains: false` skips running `node --version`… (faster, for tests). */
export const scanProject = (host: Host, folder: string, { toolchains = true } = {}) => knycSys(host, { op: "scan", folder, toolchains }, scanSchema);
export const graphProject = (host: Host, folder: string) => knycSys(host, { op: "graph", folder }, graphSchema);

export const intakeSchema = z.looseObject({
  source: z.string(),
  sandbox: z.string(),
  hash: z.string(),
  filesCopied: z.number(),
  filesForAi: z.number(),
});
export type IntakeReport = z.infer<typeof intakeSchema>;

const testCaseSchema = z.object({
  file: z.string(),
  name: z.string(),
  status: z.enum(["pass", "fail", "skip"]),
  durationMs: z.number(),
  failure: z
    .object({
      message: z.string(),
      expected: z.string().optional(),
      actual: z.string().optional(),
      file: z.string().optional(),
      line: z.number().optional(),
    })
    .optional(),
});

export const checkOutcomeSchema = z.object({
  status: z.enum(["pass", "fail", "timeout", "error"]),
  run: z
    .object({
      exitCode: z.number().nullable(),
      timedOut: z.boolean(),
      durationMs: z.number(),
      stdout: z.string(),
      stderr: z.string(),
      truncated: z.boolean(),
    })
    .optional(),
  tests: z
    .object({ success: z.boolean(), passed: z.number(), failed: z.number(), skipped: z.number(), tests: z.array(testCaseSchema) })
    .optional(),
  error: z.string().optional(),
});
export type CheckOutcome = z.infer<typeof checkOutcomeSchema>;

export const intakeProject = (host: Host, source: string, sandbox: string) => knycSys(host, { op: "intake", source, sandbox }, intakeSchema);

export interface RunOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Jest/Vitest JSON report the command writes, relative to cwd. */
  report?: string;
}

/** Runs a shell command line through the knyc-sys run step (timeout + process-tree kill). */
export function runCommand(host: Host, cwd: string, command: string, options: RunOptions = {}) {
  const request: SysRequest = { op: "run", cwd, command, timeoutMs: options.timeoutMs ?? 120_000, env: options.env ?? {}, report: options.report };
  return knycSys(host, request, checkOutcomeSchema);
}
