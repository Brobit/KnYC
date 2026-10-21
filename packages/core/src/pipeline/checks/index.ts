// Stage ⑧ (design/02-analysis-pipeline.md): every step gets checks that are proven red → green on
// the reference timeline — the project's own tests first, then generated checks.

import type { AiClient } from "../../ai/client.ts";
import { AiError } from "../../ai/types.ts";
import type { Check } from "../../schemas/check.ts";
import type { LearningPath } from "../../schemas/learning-path.ts";
import type { Graph, Scan } from "../../sys/knyc-sys.ts";
import { git, stepOfUnits, type Timeline } from "../timeline.ts";
import { buildUnits } from "../units.ts";
import { buildOutDir, checkoutStep, compiledPath } from "../workspace.ts";
import { mapTests, runSuiteAtStep, suiteCommand, type SuiteRun, type TestMapping } from "./existing.ts";
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

export interface ChecksOptions {
  sourceRoot: string;
  client: AiClient;
  /** Extra AI rounds per step when its checks don't prove the step. Default 2. */
  retries?: number;
  onProgress?: (message: string) => void;
  now?: () => Date;
}

export async function buildChecks(
  path: LearningPath,
  timeline: Timeline,
  graph: Graph,
  scan: Scan,
  options: ChecksOptions,
): Promise<ChecksResult> {
  const at = (options.now ?? (() => new Date()))().toISOString();
  const log = options.onProgress ?? (() => {});
  const workDir = timeline.workDir;
  const tagged = timeline.steps.filter((s) => s.tag);
  const setupTag = `${path.id}/s00`;
  const previousTag = (stepId: string) => {
    const i = tagged.findIndex((s) => s.stepId === stepId);
    return i <= 0 ? setupTag : tagged[i - 1]!.tag!;
  };

  // 1. The project's own tests.
  const runner = scan.testRunners[0]?.runner;
  const command = runner ? suiteCommand(runner) : null;
  let mapping: TestMapping = { byStep: new Map(), discarded: [] };
  if (runner && command) {
    const testFiles = graph.files.filter((f) => f.test).map((f) => f.path);
    const runs: SuiteRun[] = [];
    for (const step of [{ stepId: null, tag: setupTag }, ...tagged.map((s) => ({ stepId: s.stepId, tag: s.tag! }))]) {
      runs.push(await runSuiteAtStep(workDir, step, scan, testFiles, options.sourceRoot, command));
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
    const changed = (await git(workDir, "diff", "--name-only", before, tag, "--", ...sources)).split("\n").filter(Boolean);
    const imported = new Set(
      changed.flatMap((f) => (graphFiles.get(f)?.imports ?? []).map((i) => i.resolved).filter((r): r is string => !!r && sources.includes(r) && !changed.includes(r))),
    );
    const context = new Map<string, string>();
    let budget = 24_000;
    for (const file of imported) {
      const code = await git(workDir, "show", `${tag}:${file}`);
      if (code.length > budget) continue;
      budget -= code.length;
      context.set(file, code);
    }
    return context;
  };

  const layout = await buildOutDir(workDir);
  const dependencies = Object.keys(scan.packages[0]?.dependencies ?? {});
  const accepted = new Map<string, CandidateCheck[]>();
  const report = new Map<string, StepChecks>(
    path.steps.map((s) => [s.id, { stepId: s.id, strength: "weak", existing: mapping.byStep.get(s.id)?.length ?? 0, generated: 0, aiCalls: 0, notes: [] }]),
  );
  for (const build of timeline.steps.filter((s) => s.mergedInto)) {
    report.get(build.stepId)!.strength = "merged";
    report.get(build.stepId)!.notes.push(`doesn't build alone; merged into ${build.mergedInto}`);
  }

  for (const build of tagged) {
    const entry = report.get(build.stepId)!;
    if (entry.existing > 0) continue;
    const step = path.steps.find((s) => s.id === build.stepId)!;
    const before = previousTag(step.id);
    const sources = (await git(workDir, "ls-tree", "-r", "--name-only", build.tag!)).split("\n").filter((f) => graph.files.some((g) => g.path === f && !g.test));
    const ctx: StepContext = {
      step,
      diff: await git(workDir, "diff", before, build.tag!, "--", ...sources),
      importPaths: new Map(sources.map((src) => [src, `../${compiledPath(src, layout)}`])),
      dependencies,
      exports: exportsAt(path.steps.indexOf(step), sources),
      context: await contextFor(build.tag!, before, sources),
    };

    let problems: string[] = [];
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
      const candidates = answer.checks.map((c, i) => ({ ...c, file: `${CHECKS_DIR}/${step.id}-${attempt + 1}-${i + 1}.test.mjs` }));

      await checkoutStep(workDir, build.tag!, scan);
      const atStep = await Promise.all(candidates.map((c) => runCandidate(workDir, c)));
      await checkoutStep(workDir, before, scan);
      const beforeStep = await Promise.all(
        candidates.map((c, i) => (atStep[i]!.status === "pass" ? runCandidate(workDir, c) : Promise.resolve(null))),
      );

      problems = [];
      const good: CandidateCheck[] = [];
      candidates.forEach((c, i) => {
        const problem = describeProblem(c.label, atStep[i]!, beforeStep[i] ?? null);
        if (problem) problems.push(problem);
        else good.push(c);
      });
      log(`${step.id} attempt ${attempt + 1}: ${good.length}/${candidates.length} checks proven`);
      if (good.length > 0) {
        accepted.set(step.id, good);
        break;
      }
    }
    if (!accepted.has(step.id) && problems.length > 0) entry.notes.push(`no proven check after retries; last problem: ${problems[0]!.split("\n")[0]}`);
  }

  // 3. Generated checks must also pass at the last step (they shouldn't break as the code grows).
  const last = tagged.at(-1)!;
  if (accepted.size > 0) {
    await checkoutStep(workDir, last.tag!, scan);
    for (const [stepId, list] of accepted) {
      const kept: CandidateCheck[] = [];
      for (const check of list) {
        if ((await runCandidate(workDir, check)).status === "pass") kept.push(check);
        else report.get(stepId)!.notes.push(`"${check.label}" breaks at the last step; dropped`);
      }
      if (kept.length > 0) accepted.set(stepId, kept);
      else accepted.delete(stepId);
    }
  }

  // 4. Check documents and updated steps.
  const checks: Check[] = [];
  const files = new Map<string, string>();
  const steps = path.steps.map((step) => {
    const entry = report.get(step.id)!;
    const ids: string[] = [];
    const add = (check: Omit<Check, "schemaVersion" | "id" | "stepId">) => {
      const id = `chk-${step.id}-${ids.length + 1}`;
      ids.push(id);
      checks.push({ schemaVersion: 1, id, stepId: step.id, ...check });
    };
    const proven = { failsOnPrevious: true, passesOnReference: true, at };

    for (const test of mapping.byStep.get(step.id) ?? []) {
      const name = test.split(" › ").slice(1).join(" › ");
      add({ label: name, origin: "repo", timeoutMs: 120_000, validation: proven, spec: { kind: "test", root: ".", runner: runner as "vitest", command: command!, filter: [name], files: [] } });
    }
    for (const check of accepted.get(step.id) ?? []) {
      files.set(check.file, check.code);
      add({ label: check.label, origin: "generated", timeoutMs: 60_000, validation: proven, spec: { kind: "test", root: ".", runner: "other", command: `node --test ${check.file}`, filter: [], files: [check.file] } });
    }
    entry.generated = accepted.get(step.id)?.length ?? 0;
    if (entry.strength !== "merged") entry.strength = ids.length > 0 ? "strong" : "weak";
    if (entry.strength === "weak" && scan.commands[0]?.build) {
      add({ label: "The project builds", origin: "generated", timeoutMs: 300_000, spec: { kind: "build", root: ".", command: scan.commands[0].build } });
    }
    return {
      ...step,
      checkIds: ids,
      checkStrength: entry.strength === "strong" ? ("strong" as const) : ("weak" as const),
      prep: "checks-ready" as const,
    };
  });

  return { checks, files, path: { ...path, steps }, report: [...report.values()], discardedTests: mapping.discarded };
}

export { mapTests, runSuiteAtStep, suiteCommand } from "./existing.ts";
