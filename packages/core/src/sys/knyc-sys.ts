import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { formatIssues } from "../schemas/documents.ts";

// Shapes of the JSON printed by the Rust `knyc-sys` binary (crates/knyc-sys). Only the fields
// the pipeline reads are listed; extra fields are allowed so Rust can grow without breaking TS.

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

/**
 * The knyc-sys binary: $KNYC_SYS, else the workspace build (release, then debug).
 * Packaged apps will ship it next to the CLI later.
 */
export function findKnycSys(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.KNYC_SYS) return env.KNYC_SYS;
  const exe = process.platform === "win32" ? "knyc-sys.exe" : "knyc-sys";
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  return ["release", "debug"].map((profile) => join(repo, "target", profile, exe)).find((p) => existsSync(p));
}

/** Runs `knyc-sys <args>` and validates its JSON output with `schema`. */
export async function knycSys<S extends z.ZodType>(args: string[], schema: S, binary = findKnycSys()): Promise<z.infer<S>> {
  if (!binary) throw new KnycSysError("knyc-sys not found: build it with `cargo build -p knyc-sys` or set KNYC_SYS");
  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (e) => reject(new KnycSysError(`could not start knyc-sys: ${e.message}`)));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
  if (code !== 0) throw new KnycSysError(`knyc-sys ${args[0]} failed: ${stderr.trim() || `exit code ${code}`}`);

  const parsed = schema.safeParse(JSON.parse(stdout));
  if (!parsed.success) {
    throw new KnycSysError(`unexpected knyc-sys ${args[0]} output:\n- ${formatIssues(parsed.error).join("\n- ")}`);
  }
  return parsed.data;
}

export const scanProject = (folder: string, binary?: string) => knycSys(["scan", folder], scanSchema, binary);
export const graphProject = (folder: string, binary?: string) => knycSys(["graph", folder], graphSchema, binary);

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

export const intakeProject = (source: string, sandbox: string, binary?: string) =>
  knycSys(["intake", source, sandbox], intakeSchema, binary);

export interface RunOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Jest/Vitest JSON report the command writes, relative to cwd. */
  report?: string;
  binary?: string;
}

/** Runs a shell command line through `knyc-sys run` (timeout + process-tree kill). */
export function runCommand(cwd: string, command: string, options: RunOptions = {}) {
  const args = ["run", "--cwd", cwd, "--timeout-ms", String(options.timeoutMs ?? 120_000)];
  for (const [k, v] of Object.entries(options.env ?? {})) args.push("--env", `${k}=${v}`);
  if (options.report) args.push("--report", options.report);
  args.push("--", ...command.split(" ").filter(Boolean));
  return knycSys(args, checkOutcomeSchema, options.binary);
}
