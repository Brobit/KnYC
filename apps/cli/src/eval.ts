// `knyc eval`: runs the full analysis on several projects and measures it (M1 go / no-go, #15).
// Projects run one after the other; a failure (e.g. a usage limit) is recorded and the run goes
// on. Everything finished is cached, so running again resumes cheaply.

import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { auditCheck, type PathSize, type Usage } from "@knyc/core";
import { analyze, type AnalyzeIo, type AnalyzeOptions } from "./analyze.ts";
import type { StageStat } from "./report.ts";

export interface ProjectResult {
  project: string;
  size: PathSize;
  error?: string;
  steps?: number;
  milestones?: number;
  units?: number;
  /** Steps with at least one proven check that tests behavior (project tests count as behavior). */
  proven?: number;
  /** Steps whose only proven checks are trivial (import / existence). */
  trivialOnly?: number;
  weak?: number;
  merged?: number;
  timelineBuilds?: number;
  finalMatchesOriginal?: boolean;
  checks?: { repo: number; generated: number; trivial: number };
  aiCalls?: number;
  /** Extra AI calls spent on generated checks beyond the first attempt per step. */
  checkRetries?: number;
  stages?: StageStat[];
  seconds?: number;
  usage?: Usage;
  costUsd?: number;
}

export async function evaluateProject(options: AnalyzeOptions, io: AnalyzeIo): Promise<ProjectResult> {
  const base = { project: basename(resolve(options.folder)), size: options.size };
  try {
    const result = await analyze({ ...options, yes: true }, io);
    if (!result) return { ...base, error: "cancelled" };

    const audits = new Map(
      result.checks
        .filter((c) => c.origin === "generated" && c.spec.kind === "test" && c.validation)
        .map((c) => [c.id, auditCheck(result.checkFiles.get(c.spec.kind === "test" ? c.spec.files[0]! : "") ?? "")]),
    );
    let proven = 0;
    let trivialOnly = 0;
    for (const step of result.path.steps) {
      const mine = result.checks.filter((c) => c.stepId === step.id && c.validation);
      const behavior = mine.filter((c) => c.origin === "repo" || audits.get(c.id)?.kind === "behavior");
      if (behavior.length > 0) proven += 1;
      else if (mine.length > 0) trivialOnly += 1;
    }
    const byStrength = (s: string) => result.report.filter((r) => r.strength === s).length;
    const generatedSteps = result.report.filter((r) => r.aiCalls > 0);

    return {
      ...base,
      steps: result.path.steps.length,
      milestones: result.path.milestones.length,
      units: result.units,
      proven,
      trivialOnly,
      weak: byStrength("weak"),
      merged: byStrength("merged"),
      timelineBuilds: result.timeline.steps.filter((s) => s.ok).length,
      finalMatchesOriginal: result.timeline.finalMatchesOriginal,
      checks: {
        repo: result.checks.filter((c) => c.origin === "repo").length,
        generated: audits.size,
        trivial: [...audits.values()].filter((a) => a.kind === "trivial").length,
      },
      aiCalls: result.totals.calls,
      checkRetries: generatedSteps.reduce((n, r) => n + r.aiCalls - 1, 0),
      stages: result.stages,
      seconds: result.stages.reduce((n, s) => n + s.seconds, 0),
      usage: result.totals.usage,
      costUsd: result.totals.costUsd,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((100 * n) / d)}%`);

export function renderEvaluation(results: ProjectResult[], threshold = 0.8): string {
  const done = results.filter((r) => !r.error);
  const steps = done.reduce((n, r) => n + r.steps!, 0);
  const proven = done.reduce((n, r) => n + r.proven!, 0);
  const verdict = proven / Math.max(1, steps) >= threshold ? "GO" : "NO-GO";

  const lines = [
    `| Project | Steps | Proven (behavior) | Trivial only | Weak | Merged | Timeline builds | Final = original | Checks repo / gen / trivial | AI calls | Check retries | Time |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|`,
    ...results.map((r) =>
      r.error
        ? `| ${r.project} (${r.size}) | — | **error:** ${r.error.replace(/\|/g, "\\|")} | | | | | | | | | |`
        : `| ${r.project} (${r.size}) | ${r.steps} | **${r.proven} (${pct(r.proven!, r.steps!)})** | ${r.trivialOnly} | ${r.weak} | ${r.merged} | ${r.timelineBuilds}/${r.steps} | ${r.finalMatchesOriginal ? "yes" : "**no**"} | ${r.checks!.repo} / ${r.checks!.generated} / ${r.checks!.trivial} | ${r.aiCalls} | ${r.checkRetries} | ${Math.round(r.seconds! / 60)} min |`,
    ),
    `| **Total** | **${steps}** | **${proven} (${pct(proven, steps)})** | ${done.reduce((n, r) => n + r.trivialOnly!, 0)} | ${done.reduce((n, r) => n + r.weak!, 0)} | ${done.reduce((n, r) => n + r.merged!, 0)} | | | | ${done.reduce((n, r) => n + r.aiCalls!, 0)} | ${done.reduce((n, r) => n + r.checkRetries!, 0)} | ${Math.round(done.reduce((n, r) => n + r.seconds!, 0) / 60)} min |`,
    "",
    `**${verdict}**: ${pct(proven, steps)} of steps have a proven behavior check (threshold ${Math.round(threshold * 100)}%).`,
  ];
  return lines.join("\n");
}

export async function evaluate(folders: string[], options: Omit<AnalyzeOptions, "folder" | "workspace"> & { out: string }, io: AnalyzeIo) {
  await mkdir(options.out, { recursive: true });
  const results: ProjectResult[] = [];
  for (const folder of folders) {
    io.log(`\n=== ${basename(resolve(folder))} (${options.size})`);
    const result = await evaluateProject({ ...options, folder, workspace: join(options.out, basename(resolve(folder))) }, io);
    results.push(result);
    // Written after each project, so an interrupted run keeps what it measured.
    await writeFile(join(options.out, "results.json"), JSON.stringify(results, null, 2));
    await writeFile(join(options.out, "results.md"), `${renderEvaluation(results)}\n`);
  }
  return results;
}
