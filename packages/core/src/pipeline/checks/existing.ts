// Stage ⑧, part 1 (design/02): the project's own tests, mapped to steps with no AI. A test belongs
// to the first step where it turns green, provided it stays green until the last step.

import { joinPath, type Host } from "../../host/host.ts";
import { runCommand, type Scan } from "../../sys/knyc-sys.ts";
import { checkoutStep } from "../workspace.ts";

export const REPORT_FILE = ".knyc-report.json";

/** The suite command with a JSON report, for the runners KnYC can read. */
export function suiteCommand(runner: string): string | null {
  if (runner === "vitest") return `npx vitest run --reporter=json --outputFile=${REPORT_FILE}`;
  if (runner === "jest") return `npx jest --json --outputFile=${REPORT_FILE}`;
  return null;
}

export type TestStatus = "pass" | "fail" | "skip";

export interface SuiteRun {
  /** null for s00 (setup only). */
  stepId: string | null;
  tag: string;
  built: boolean;
  /** "tests/notes.api.test.ts › /notes returns 404 for unknown routes" → status. */
  results: Map<string, TestStatus>;
}

export const testKey = (file: string, name: string) => `${file} › ${name}`;

/** Checks out a step, builds it, puts the original tests back and runs the suite. */
export async function runSuiteAtStep(
  host: Host,
  workDir: string,
  step: { stepId: string | null; tag: string },
  scan: Scan,
  testFiles: string[],
  sourceRoot: string,
  command: string,
  timeoutMs = 5 * 60_000,
): Promise<SuiteRun> {
  const { build } = await checkoutStep(host, workDir, step.tag, scan, timeoutMs);
  const results = new Map<string, TestStatus>();
  if (build.status !== "pass") return { ...step, built: false, results };

  for (const file of testFiles) await host.copyFile(joinPath(sourceRoot, file), joinPath(workDir, file));
  const outcome = await runCommand(host, workDir, command, { report: REPORT_FILE, timeoutMs });
  for (const test of outcome.tests?.tests ?? []) {
    // "(could not run)" entries stand for a whole file that can't load yet: its tests are red.
    if (!test.name.endsWith("(could not run)")) results.set(testKey(test.file, test.name), test.status);
  }
  return { ...step, built: true, results };
}

export interface TestMapping {
  /** stepId → keys of the tests that turn green at that step. */
  byStep: Map<string, string[]>;
  /** Tests that can't prove a step, with why. */
  discarded: { test: string; reason: string }[];
}

/** `runs` in timeline order, starting with s00. A test missing from a run counts as red there. */
export function mapTests(runs: SuiteRun[]): TestMapping {
  const all = new Set(runs.flatMap((r) => [...r.results.keys()]));
  const byStep = new Map<string, string[]>();
  const discarded: TestMapping["discarded"] = [];
  const status = (run: SuiteRun, test: string) => run.results.get(test) ?? "fail";

  for (const test of [...all].sort()) {
    const first = runs.findIndex((r) => status(r, test) === "pass");
    if (first < 0) {
      discarded.push({ test, reason: runs.some((r) => status(r, test) === "skip") ? "skipped" : "never passes" });
      continue;
    }
    if (runs[first]!.stepId === null) {
      discarded.push({ test, reason: "passes before any step (tests nothing the learner writes)" });
      continue;
    }
    const breaksLater = runs.slice(first + 1).find((r) => status(r, test) !== "pass");
    if (breaksLater) {
      discarded.push({ test, reason: `passes at ${runs[first]!.stepId} but not at ${breaksLater.stepId}` });
      continue;
    }
    const stepId = runs[first]!.stepId!;
    byStep.set(stepId, [...(byStep.get(stepId) ?? []), test]);
  }
  return { byStep, discarded };
}
