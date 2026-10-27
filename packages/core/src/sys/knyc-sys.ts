import { z } from "zod";
import type { Container, DockerSpec, Host, HttpRequest, HttpServer, SysRequest } from "../host/host.ts";
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
  /** Docker mode (#91): run in a container instead of on the machine. */
  container?: Container;
}

/** Runs a shell command line through the knyc-sys run step (timeout + process-tree kill). */
export function runCommand(host: Host, cwd: string, command: string, options: RunOptions = {}) {
  const request: SysRequest = { op: "run", cwd, command, timeoutMs: options.timeoutMs ?? 120_000, env: options.env ?? {}, report: options.report, ...(options.container ? { container: options.container } : {}) };
  return knycSys(host, request, checkOutcomeSchema);
}

export const httpOutcomeSchema = z.object({
  status: z.enum(["pass", "fail", "timeout", "error"]),
  /** The port the server answered on. */
  port: z.number().optional(),
  requests: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      status: z.number().nullable().optional(),
      body: z.string(),
      problem: z.string().optional(),
    }),
  ),
  /** What the server printed, truncated. */
  output: z.string(),
  error: z.string().optional(),
  durationMs: z.number(),
});
export type HttpOutcome = z.infer<typeof httpOutcomeSchema>;

/** Runs an HTTP check through knyc-sys (#88): the server is started in `cwd` and always stopped. */
export function runHttpCheck(host: Host, cwd: string, server: HttpServer, requests: HttpRequest[], timeoutMs = 30_000, container?: Container) {
  return knycSys(host, { op: "http", cwd, timeoutMs, server, requests, ...(container ? { container } : {}) }, httpOutcomeSchema);
}

export const uiOutcomeSchema = z.object({
  status: z.enum(["pass", "fail", "timeout", "error", "unavailable"]),
  port: z.number().optional(),
  tests: z.array(
    z.object({
      file: z.string(),
      status: z.string(),
      durationMs: z.number().default(0),
      error: z.string().optional(),
      url: z.string().optional(),
      pageErrors: z.array(z.string()).default([]),
      /** The page's accessibility tree when the test failed. */
      snapshot: z.string().optional(),
      /** A JPEG of the page when the test failed, base64. */
      screenshot: z.string().optional(),
    }),
  ),
  /** What the server printed, then what the tests printed. */
  output: z.string(),
  error: z.string().optional(),
  durationMs: z.number(),
});
export type UiOutcome = z.infer<typeof uiOutcomeSchema>;

/** Runs UI tests in headless Chromium through knyc-sys (#89), against the frontend started in `cwd`. */
export function runUiCheck(
  host: Host,
  cwd: string,
  server: HttpServer,
  tests: string[],
  browsers: string | undefined,
  timeoutMs = 60_000,
  container?: Container,
  companions: (HttpServer & { cwd: string })[] = [],
) {
  return knycSys(host, { op: "ui", cwd, timeoutMs, server, tests, browsers, ...(container ? { container } : {}), ...(companions.length > 0 ? { companions } : {}) }, uiOutcomeSchema);
}

export const browserStatusSchema = z.object({ installed: z.boolean(), revision: z.string().optional() });
export const browserSizeSchema = z.object({ bytes: z.number(), urls: z.array(z.string()).default([]) });
export const browserInstallSchema = z.object({ installed: z.boolean(), error: z.string().optional() });

/** Whether Chromium is in `browsers` (KnYC's data folder), for the UI checks (#89). */
export const browserStatus = (host: Host, browsers?: string) => knycSys(host, { op: "browser", action: "status", browsers }, browserStatusSchema);
/** How much downloading Chromium takes, in bytes. */
export const browserSize = (host: Host, browsers?: string) => knycSys(host, { op: "browser", action: "size", browsers }, browserSizeSchema);
/** Downloads Chromium into `browsers`. */
export const installBrowser = (host: Host, browsers?: string) => knycSys(host, { op: "browser", action: "install", browsers }, browserInstallSchema);

export const dockerOutcomeSchema = z.object({
  /** "unavailable": Docker isn't installed or its daemon isn't running. */
  status: z.enum(["pass", "fail", "timeout", "error", "unavailable"]),
  /** How far it got: "build", "run", "health". */
  stage: z.string(),
  /** The build's output, then the container's logs; truncated. */
  output: z.string(),
  error: z.string().optional(),
  durationMs: z.number(),
});
export type DockerOutcome = z.infer<typeof dockerOutcomeSchema>;

/** Runs a Docker check through knyc-sys (#90); what it makes is always removed. */
export function runDockerCheck(host: Host, cwd: string, spec: DockerSpec, timeoutMs = 300_000) {
  return knycSys(host, { op: "docker", cwd, timeoutMs, spec }, dockerOutcomeSchema);
}
