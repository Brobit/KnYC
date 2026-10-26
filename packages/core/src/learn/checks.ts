// Running a step's checks in the learner's workspace (#62, design/04 §7): one Run for the whole
// step. Dependencies are installed when missing and the project is built first, as the checks were
// proven on built code (design/02 ⑧). Test files the learner shouldn't edit (generated checks, the
// project's own tests) are copied in only while the checks run.

import type { HttpRequest, HttpServer } from "../host/host.ts";
import { REPORT_FILE } from "../pipeline/checks/existing.ts";
import { failureExcerpt } from "../pipeline/checks/generated.ts";
import { builds, installs, type PackageCommands } from "../pipeline/packages.ts";
import type { Check, CheckRun } from "../schemas/check.ts";
import type { PathProgress, Progress } from "../schemas/progress.ts";
import type { CheckOutcome, HttpOutcome } from "../sys/knyc-sys.ts";
import { knycPaths } from "./documents.ts";

/** The workspace folder, relative paths with "/". `write` creates missing folders. */
export interface WorkspaceFiles {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface CheckCommand {
  command: string;
  /** Package folder, relative to the workspace. */
  root: string;
  timeoutMs: number;
  env?: Record<string, string>;
  /** Jest/Vitest JSON report the command writes, relative to `root`. */
  report?: string;
}

export interface RunStepChecksInput {
  checks: Check[];
  pathId: string;
  files: WorkspaceFiles;
  /** Runs one command in the workspace (timeout, process-tree kill, optional report). */
  run: (request: CheckCommand) => Promise<CheckOutcome>;
  /** project.json's commands, per package: install where `node_modules` is missing, build before the checks. */
  commands?: PackageCommands;
  /** The project's own test files, stored under `.knyc/checks/<pathId>/tests/`. */
  testFiles?: string[];
  onResult?: (run: CheckRun) => void;
  /** Runs an HTTP check against the project's server (src-tauri `workspace_http_check`, #88). */
  runHttp?: (request: { root: string; timeoutMs: number; server: HttpServer; requests: HttpRequest[] }) => Promise<HttpOutcome>;
  now?: () => Date;
}

/** An HTTP check's outcome as a CheckRun: each request's answer, then what the server printed. */
export function httpRun(checkId: string, outcome: HttpOutcome, at: string): CheckRun {
  const lines = outcome.requests.map((r) => `${r.method} ${r.path} → ${r.status ?? "no answer"}${r.problem ? `: ${r.problem}` : ""}`);
  const output = [...lines, ...(outcome.error ? [outcome.error] : []), ...(outcome.output.trim() ? ["", "Server output:", outcome.output.trim()] : [])].join("\n");
  const failures = [
    ...(outcome.error && outcome.status !== "pass" ? [{ message: `${outcome.error}${outcome.output.trim() ? `\n${outcome.output.trim().split("\n").slice(-15).join("\n")}` : ""}` }] : []),
    ...outcome.requests.filter((r) => r.problem).map((r) => ({ message: `${r.method} ${r.path}: ${r.problem}`, actual: r.body || undefined })),
  ];
  return { checkId, at, status: outcome.status, durationMs: outcome.durationMs, output: output.length > MAX_OUTPUT ? output.slice(-MAX_OUTPUT) : output, failures };
}

const MAX_OUTPUT = 64 * 1024;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 5 * 60_000;

const outputOf = (outcome: CheckOutcome) => {
  const text = [outcome.run?.stdout, outcome.run?.stderr, outcome.error].filter(Boolean).join("\n").trim();
  return text.length > MAX_OUTPUT ? text.slice(-MAX_OUTPUT) : text;
};

/** Runs every check of a step; results come in check order, and one by one through `onResult`. */
export async function runStepChecks(input: RunStepChecksInput): Promise<CheckRun[]> {
  const { checks, files, run } = input;
  const at = () => (input.now ?? (() => new Date()))().toISOString();
  const paths = knycPaths(input.pathId);
  const results = new Map<string, CheckRun>();
  const record = (check: Check, outcome: CheckOutcome, failure?: CheckRun["failures"][number]) => {
    const result: CheckRun = {
      checkId: check.id,
      at: at(),
      status: outcome.status,
      durationMs: outcome.run?.durationMs ?? 0,
      output: outputOf(outcome),
      failures: outcome.status === "pass" ? [] : [failure ?? { message: failureExcerpt(outcome) || outcome.error || "The check failed." }],
    };
    results.set(check.id, result);
    input.onResult?.(result);
  };
  const done = () => checks.map((c) => results.get(c.id)!);
  const failRest = (status: CheckRun["status"], message: string, outcome: CheckOutcome) => {
    for (const check of checks) if (!results.has(check.id)) record(check, { ...outcome, status }, { message: `${message}\n${failureExcerpt(outcome)}`.trim() });
    return done();
  };

  // 1. Dependencies, once per package that installs (once at a workspace's root, #87).
  const commands = input.commands ?? [];
  for (const { root, command } of installs(commands)) {
    if (await files.exists(root === "." ? "node_modules" : `${root}/node_modules`)) continue;
    const installed = await run({ command, root, timeoutMs: INSTALL_TIMEOUT_MS });
    if (installed.status !== "pass") return failRest("error", `Installing the dependencies${root === "." ? "" : ` of ${root}`} failed.`, installed);
  }

  // 2. The build, package by package. A build check is its package's build; the others need
  // every build to pass.
  for (const { root, command } of builds(commands)) {
    const built = await run({ command, root, timeoutMs: BUILD_TIMEOUT_MS });
    for (const check of checks) if (check.spec.kind === "build" && check.spec.root === root) record(check, built);
    if (built.status !== "pass") return failRest("fail", "The project doesn't build yet, so this check can't run.", built);
  }

  // 3. The checks, with their test files copied in for the time of the run.
  const copied: string[] = [];
  // Top folders made for the copies (".knyc-checks"), removed with them.
  const madeDirs = new Set<string>();
  const copy = async (from: string, to: string) => {
    const top = to.includes("/") ? to.slice(0, to.indexOf("/")) : null;
    if (top && !madeDirs.has(top) && !(await files.exists(top))) madeDirs.add(top);
    await files.write(to, await files.read(from));
    copied.push(to);
  };
  try {
    const repo = checks.filter((c) => c.origin === "repo" && c.spec.kind === "test");
    if (repo.length > 0) for (const file of input.testFiles ?? []) await copy(paths.testFile(file), file);

    // The project's suite runs once per command; each check is one of its tests.
    const suites = new Map<string, Check[]>();
    for (const check of repo) if (check.spec.kind === "test") suites.set(`${check.spec.root}\u0000${check.spec.command}`, [...(suites.get(`${check.spec.root}\u0000${check.spec.command}`) ?? []), check]);
    for (const list of suites.values()) {
      const spec = list[0]!.spec as Extract<Check["spec"], { kind: "test" }>;
      copied.push(spec.root === "." ? REPORT_FILE : `${spec.root}/${REPORT_FILE}`);
      const timeoutMs = Math.max(...list.map((c) => c.timeoutMs));
      const outcome = await run({ command: spec.command, root: spec.root, timeoutMs, report: REPORT_FILE });
      for (const check of list) {
        const name = check.spec.kind === "test" ? check.spec.filter[0] : undefined;
        const test = outcome.tests?.tests.find((t) => t.name === name);
        if (!test) {
          record(check, { ...outcome, status: outcome.status === "timeout" ? "timeout" : "fail" }, { message: `The test "${name}" didn't run.\n${failureExcerpt(outcome)}`.trim() });
        } else {
          const status = test.status === "pass" ? "pass" : "fail";
          const failure = test.failure ? { ...test.failure, file: test.failure.file ?? test.file } : { message: `The test "${name}" ${test.status === "skip" ? "was skipped" : "failed"}.` };
          record(check, { ...outcome, status, run: outcome.run && { ...outcome.run, durationMs: test.durationMs } }, failure);
        }
      }
    }

    for (const check of checks) {
      if (results.has(check.id)) continue;
      const spec = check.spec;
      if (spec.kind === "test") {
        for (const file of spec.files) await copy(paths.checkFile(file), file);
        // PORT=0: a server started by the project's entry point gets a free port (as when proven).
        record(check, await run({ command: spec.command, root: spec.root, timeoutMs: check.timeoutMs, env: { PORT: "0" } }));
      } else if (spec.kind === "build") {
        record(check, await run({ command: spec.command, root: spec.root, timeoutMs: check.timeoutMs }));
      } else if (spec.kind === "http" && input.runHttp) {
        // The server starts in its package for this check, and is stopped after it (#88).
        const outcome = await input.runHttp({ root: spec.server.root, timeoutMs: check.timeoutMs, server: spec.server, requests: spec.requests });
        const result = httpRun(check.id, outcome, at());
        results.set(check.id, result);
        input.onResult?.(result);
      } else {
        record(check, { status: "error", error: `"${spec.kind}" checks can't run in the app yet.` });
      }
    }
  } finally {
    for (const file of copied) await files.remove(file).catch(() => {});
    for (const dir of madeDirs) await files.remove(dir).catch(() => {});
  }
  return done();
}

/** Keeps the last `keep` runs of a step (design/03: runs/<pathId>/<stepId>.jsonl). */
export async function appendRuns(files: WorkspaceFiles, pathId: string, stepId: string, runs: CheckRun[], keep = 50): Promise<void> {
  const file = knycPaths(pathId).runs(stepId);
  const before = (await files.exists(file)) ? (await files.read(file)).split("\n").filter(Boolean) : [];
  const lines = [...before, ...runs.map((r) => JSON.stringify(r))].slice(-keep);
  await files.write(file, `${lines.join("\n")}\n`);
}

/** The latest run of each check of a step, for showing the last results when the step opens. */
export async function latestRuns(files: WorkspaceFiles, pathId: string, stepId: string): Promise<Map<string, CheckRun>> {
  const file = knycPaths(pathId).runs(stepId);
  const latest = new Map<string, CheckRun>();
  if (!(await files.exists(file))) return latest;
  for (const line of (await files.read(file)).split("\n")) {
    if (!line.trim()) continue;
    try {
      const run = JSON.parse(line) as CheckRun;
      latest.set(run.checkId, run);
    } catch {
      // A line cut by a crash: skip it.
    }
  }
  return latest;
}

/** One more attempt at the step; passed once every check passes (design/03 progress.json). */
export function withCheckAttempt(progress: Progress, pathId: string, stepId: string, passed: boolean, now: Date): Progress {
  const path: PathProgress | undefined = progress.paths[pathId];
  if (!path) return progress;
  const step = path.steps[stepId] ?? { status: "available", attempts: 0, hintsUsed: [], revealed: false, timeSpentSec: 0 };
  const at = now.toISOString();
  const status = step.status === "passed" || passed ? "passed" : "in-progress";
  return {
    ...progress,
    paths: {
      ...progress.paths,
      [pathId]: {
        ...path,
        steps: {
          ...path.steps,
          [stepId]: { ...step, status, attempts: step.attempts + 1, startedAt: step.startedAt ?? at, ...(passed && !step.passedAt ? { passedAt: at } : {}) },
        },
      },
    },
  };
}
