// Stage ⑧ (design/02-analysis-pipeline.md): every step gets checks that are proven red → green on
// the reference timeline — the project's own tests first, then generated checks.
//
// Steps are prepared one at a time (design/02 D5): `prepareChecks` maps the project's tests once,
// then `forStep` proves one step's checks, so the learner can start step 1 while later steps are
// still being prepared. `buildChecks` does every step in a row (the CLI).

import type { AiClient } from "../../ai/client.ts";
import { AiError } from "../../ai/types.ts";
import type { Host } from "../../host/host.ts";
import type { Check } from "../../schemas/check.ts";
import type { LearningPath, Step } from "../../schemas/learning-path.ts";
import type { Graph, Scan } from "../../sys/knyc-sys.ts";
import { stepOfUnits, type Timeline } from "../timeline.ts";
import { buildUnits } from "../units.ts";
import { buildOutDir, checkoutStep, compiledPath } from "../workspace.ts";
import { mapTests, runSuiteAtStep, suiteCommand, type SuiteRun, type TestMapping } from "./existing.ts";
import { fragileCheck } from "./audit.ts";
import { askForChecks, CHECKS_DIR, describeProblem, runCandidate, type CandidateCheck, type StepContext } from "./generated.ts";

export interface StepChecks {
  stepId: string;
  /** strong: at least one check proven red → green. weak: build only. merged: no tag of its own. */
  strength: "strong" | "weak" | "merged";
  existing: number;
  generated: number;
  aiCalls: number;
  notes: string[];
}

export interface ChecksResult {
  checks: Check[];
  /** Generated check files: path in the working copy → code. */
  files: Map<string, string>;
  path: LearningPath;
  report: StepChecks[];
  discardedTests: TestMapping["discarded"];
}

/** One step's checks, ready for the learner. */
export interface StepChecksResult {
  checks: Check[];
  /** Generated check files: path in the working copy → code. */
  files: Map<string, string>;
  report: StepChecks;
  /** The step with its check ids and strength, prep "checks-ready". */
  step: Step;
}

export interface ChecksPreparation {
  /** Which of the project's tests prove which step (save it to skip the suite runs next time). */
  mapping: TestMapping;
  /** Proves one step's checks. Steps can be prepared in any order, one call at a time. */
  forStep(stepId: string): Promise<StepChecksResult>;
}

export interface ChecksOptions {
  host: Host;
  sourceRoot: string;
  client: AiClient;
  /** Extra AI rounds per step when its checks don't prove the step. Default 2. */
  retries?: number;
  onProgress?: (message: string) => void;
  now?: () => Date;
  /** The test mapping of an earlier run on the same timeline (the suite isn't run again). */
  mapping?: TestMapping;
}

export async function prepareChecks(
  path: LearningPath,
  timeline: Timeline,
  graph: Graph,
  scan: Scan,
  options: ChecksOptions,
): Promise<ChecksPreparation> {
  const log = options.onProgress ?? (() => {});
  const { host } = options;
  const workDir = timeline.workDir;
  const git = (...args: string[]) => host.git(workDir, args);
  const tagged = timeline.steps.filter((s) => s.tag);
  const setupTag = `${path.id}/s00`;
  const previousTag = (stepId: string) => {
    const i = tagged.findIndex((s) => s.stepId === stepId);
    return i <= 0 ? setupTag : tagged[i - 1]!.tag!;
  };

  // 1. The project's own tests.
  const runner = scan.testRunners[0]?.runner;
  const command = runner ? suiteCommand(runner) : null;
  let mapping: TestMapping = options.mapping ?? { byStep: new Map(), discarded: [] };
  if (runner && command && !options.mapping) {
    const testFiles = graph.files.filter((f) => f.test).map((f) => f.path);
    const runs: SuiteRun[] = [];
    for (const step of [{ stepId: null, tag: setupTag }, ...tagged.map((s) => ({ stepId: s.stepId, tag: s.tag! }))]) {
      runs.push(await runSuiteAtStep(host, workDir, step, scan, testFiles, options.sourceRoot, command));
      log(`suite at ${step.stepId ?? "s00"}`);
    }
    mapping = mapTests(runs);
  }

  // 2. Generated checks for the steps those tests don't cover.
  const units = buildUnits(graph);
  const stepOf = stepOfUnits(path, units);
  const graphFiles = new Map(graph.files.map((f) => [f.path, f]));

  /** What each existing module exports at step k: names the model must use. */
  const exportsAt = (k: number, sources: string[]) =>
    new Map(
      sources.map((src) => {
        const kept = (id: string) => (stepOf.get(id) ?? Infinity) <= k;
        const symbols = graphFiles.get(src)?.symbols ?? [];
        const names = symbols
          .filter((s) => s.exported && !s.name.includes(".") && (kept(`${src}#${s.name}`) || kept(src)))
          .map((s) => {
            const methods = symbols
              .filter((m) => m.kind === "method" && m.name.startsWith(`${s.name}.`) && !m.name.endsWith(".constructor") && (kept(`${src}#${m.name}`) || kept(src)))
              .map((m) => m.name.slice(s.name.length + 1));
            return `${s.kind} ${s.name}${methods.length ? ` (methods: ${methods.join(", ")})` : ""}`;
          });
        return [src, names] as const;
      }),
    );

  /** Source, at the step, of the local files that the step's changed files import (capped). */
  const contextFor = async (tag: string, before: string, sources: string[]) => {
    const changed = (await git("diff", "--name-only", before, tag, "--", ...sources)).split("\n").filter(Boolean);
    const imported = new Set(
      changed.flatMap((f) => (graphFiles.get(f)?.imports ?? []).map((i) => i.resolved).filter((r): r is string => !!r && sources.includes(r) && !changed.includes(r))),
    );
    const context = new Map<string, string>();
    let budget = 24_000;
    for (const file of imported) {
      const code = await git("show", `${tag}:${file}`);
      if (code.length > budget) continue;
      budget -= code.length;
      context.set(file, code);
    }
    return context;
  };

  const layout = await buildOutDir(host, workDir);
  const dependencies = Object.keys(scan.packages[0]?.dependencies ?? {});
  // No .at(): the desktop webview targets ES2020 (older macOS WebKit).
  const last = tagged[tagged.length - 1];

  /** Generated checks proven red → green for one step, and still green at the last step. */
  async function generatedFor(step: Step, tag: string, entry: StepChecks): Promise<CandidateCheck[]> {
    const before = previousTag(step.id);
    const sources = (await git("ls-tree", "-r", "--name-only", tag)).split("\n").filter((f) => graph.files.some((g) => g.path === f && !g.test));
    const ctx: StepContext = {
      step,
      diff: await git("diff", before, tag, "--", ...sources),
      importPaths: new Map(sources.map((src) => [src, `../${compiledPath(src, layout)}`])),
      dependencies,
      exports: exportsAt(path.steps.indexOf(step), sources),
      context: await contextFor(tag, before, sources),
    };

    let problems: string[] = [];
    let accepted: CandidateCheck[] = [];
    for (let attempt = 0; attempt <= (options.retries ?? 2); attempt++) {
      let answer;
      try {
        answer = await askForChecks(options.client, ctx, problems);
      } catch (error) {
        // A slow or failing call costs this step one attempt; a login problem or a usage limit
        // stops everything (retrying would only fail again).
        if (!(error instanceof AiError) || error.kind === "auth" || error.kind === "limit") throw error;
        entry.aiCalls += 1;
        entry.notes.push(`attempt ${attempt + 1}: ${error.message}`);
        log(`${step.id} attempt ${attempt + 1}: AI ${error.kind}`);
        continue;
      }
      entry.aiCalls += 1;
      if (answer.checks.length === 0) {
        entry.notes.push(`no runtime check: ${answer.reasonIfNone ?? "nothing observable at runtime"}`);
        break;
      }
      problems = [];
      // Fragile checks are refused before running: they could pass here and fail for the learner.
      const candidates = answer.checks
        .map((c, i) => ({ ...c, file: `${CHECKS_DIR}/${step.id}-${attempt + 1}-${i + 1}.test.mjs` }))
        .filter((c) => {
          const fragile = fragileCheck(c.code);
          for (const problem of fragile) problems.push(`"${c.label}": ${problem}`);
          return fragile.length === 0;
        });
      if (candidates.length === 0) {
        log(`${step.id} attempt ${attempt + 1}: every check is fragile`);
        continue;
      }

      await checkoutStep(host, workDir, tag, scan);
      const atStep = await Promise.all(candidates.map((c) => runCandidate(host, workDir, c)));
      await checkoutStep(host, workDir, before, scan);
      const beforeStep = await Promise.all(
        candidates.map((c, i) => (atStep[i]!.status === "pass" ? runCandidate(host, workDir, c) : Promise.resolve(null))),
      );

      const good: CandidateCheck[] = [];
      candidates.forEach((c, i) => {
        const problem = describeProblem(c.label, atStep[i]!, beforeStep[i] ?? null);
        if (problem) problems.push(problem);
        else good.push(c);
      });
      log(`${step.id} attempt ${attempt + 1}: ${good.length}/${candidates.length} checks proven`);
      if (good.length > 0) {
        accepted = good;
        break;
      }
    }
    if (accepted.length === 0 && problems.length > 0) entry.notes.push(`no proven check after retries; last problem: ${problems[0]!.split("\n")[0]}`);

    // Generated checks must also pass at the last step (they shouldn't break as the code grows).
    if (accepted.length > 0 && last && last.tag !== tag) {
      await checkoutStep(host, workDir, last.tag!, scan);
      const kept: CandidateCheck[] = [];
      for (const check of accepted) {
        if ((await runCandidate(host, workDir, check)).status === "pass") kept.push(check);
        else entry.notes.push(`"${check.label}" breaks at the last step; dropped`);
      }
      accepted = kept;
    }
    return accepted;
  }

  async function forStep(stepId: string): Promise<StepChecksResult> {
    const step = path.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`the path has no step ${stepId}`);
    const at = (options.now ?? (() => new Date()))().toISOString();
    const build = timeline.steps.find((s) => s.stepId === stepId);
    const existing = mapping.byStep.get(stepId) ?? [];
    const entry: StepChecks = { stepId, strength: "weak", existing: existing.length, generated: 0, aiCalls: 0, notes: [] };
    let generated: CandidateCheck[] = [];
    if (build?.mergedInto) {
      entry.strength = "merged";
      entry.notes.push(`doesn't build alone; merged into ${build.mergedInto}`);
    } else if (build?.tag && existing.length === 0) {
      generated = await generatedFor(step, build.tag, entry);
    }

    // Check documents and the updated step.
    const checks: Check[] = [];
    const files = new Map<string, string>();
    const add = (check: Omit<Check, "schemaVersion" | "id" | "stepId">) => {
      checks.push({ schemaVersion: 1, id: `chk-${step.id}-${checks.length + 1}`, stepId: step.id, ...check });
    };
    const proven = { failsOnPrevious: true, passesOnReference: true, at };

    for (const test of existing) {
      const name = test.split(" › ").slice(1).join(" › ");
      add({ label: name, origin: "repo", timeoutMs: 120_000, validation: proven, spec: { kind: "test", root: ".", runner: runner as "vitest", command: command!, filter: [name], files: [] } });
    }
    for (const check of generated) {
      files.set(check.file, check.code);
      add({ label: check.label, origin: "generated", timeoutMs: 60_000, validation: proven, spec: { kind: "test", root: ".", runner: "other", command: `node --test ${check.file}`, filter: [], files: [check.file] } });
    }
    entry.generated = generated.length;
    if (entry.strength !== "merged") entry.strength = checks.length > 0 ? "strong" : "weak";
    if (entry.strength === "weak" && scan.commands[0]?.build) {
      add({ label: "The project builds", origin: "generated", timeoutMs: 300_000, spec: { kind: "build", root: ".", command: scan.commands[0].build } });
    }
    return {
      checks,
      files,
      report: entry,
      step: {
        ...step,
        checkIds: checks.map((c) => c.id),
        checkStrength: entry.strength === "strong" ? "strong" : "weak",
        prep: "checks-ready",
      },
    };
  }

  return { mapping, forStep };
}

/** Every step's checks, in path order. */
export async function buildChecks(
  path: LearningPath,
  timeline: Timeline,
  graph: Graph,
  scan: Scan,
  options: ChecksOptions,
): Promise<ChecksResult> {
  const preparation = await prepareChecks(path, timeline, graph, scan, options);
  const results: StepChecksResult[] = [];
  for (const step of path.steps) results.push(await preparation.forStep(step.id));
  return {
    checks: results.flatMap((r) => r.checks),
    files: new Map(results.flatMap((r) => [...r.files])),
    path: { ...path, steps: results.map((r) => r.step) },
    report: results.map((r) => r.report),
    discardedTests: preparation.mapping.discarded,
  };
}

export { mapTests, runSuiteAtStep, suiteCommand } from "./existing.ts";
