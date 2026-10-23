// What the import screen shows before anything is sent to the AI (#59, design/04 §3, design/02 D4):
// the quick scan, what is excluded and why, and an estimate of the analysis. With the Claude Code
// CLI there is no per-call price: the estimate is AI calls and time (design/06 H3).

import { profiles } from "../profiles/index.ts";
import type { PathSize } from "../schemas/learning-path.ts";
import type { Graph, Scan } from "../sys/knyc-sys.ts";
import { behaviorCount, stepRange } from "./plan.ts";
import { batchBySize } from "./summaries.ts";
import { buildUnits } from "./units.ts";

/** One Claude Code call's own instructions, measured in M1. */
export const CALL_OVERHEAD_TOKENS = 6_000;
/** M1 runs averaged 54 AI calls in 40 minutes, builds included (design/08). */
export const SECONDS_PER_CALL = 45;

export interface AnalysisEstimate {
  /** Steps the path will have at this size (middle of the planner's range). */
  steps: number;
  summaryCalls: number;
  /** Summaries, the plan, then about one call per step for the checks. */
  calls: number;
  tokens: number;
  minutes: number;
}

/**
 * The estimate shared by the CLI and the import screen. `fileTokens`: token size of each file the
 * summaries read, in layer order (the CLI counts the real content, the import screen file sizes).
 * `unitCount`: units with behavior, as the planner counts them (plan.ts `behaviorCount`).
 */
export function estimateAnalysis(fileTokens: number[], unitCount: number, size: PathSize): AnalysisEstimate {
  const range = stepRange(size, unitCount);
  const steps = Math.round((range.min + range.max) / 2);
  // Files in batches, then one call for the folders and one for the project.
  const summaryCalls = batchBySize(fileTokens, (t) => t).length + 2;
  const calls = summaryCalls + 1 + steps;
  const sourceTokens = fileTokens.reduce((sum, t) => sum + t, 0);
  const tokens = sourceTokens + calls * CALL_OVERHEAD_TOKENS + steps * 4_000;
  return { steps, summaryCalls, calls, tokens, minutes: Math.max(1, Math.round((calls * SECONDS_PER_CALL) / 60)) };
}

export type ExclusionReason = "secret" | "ignored" | "binary" | "lockfile" | "too-large";
const REASONS: ExclusionReason[] = ["secret", "ignored", "binary", "lockfile", "too-large"];

export interface ImportReport {
  files: number;
  lines: number;
  /** Files the summaries will read. */
  filesSent: number;
  filesExcluded: number;
  /** Grouped by reason, secrets first. */
  excluded: { reason: ExclusionReason; paths: string[] }[];
  languages: string[];
  /** "Express 4.21", from the scan's frameworks. */
  frameworks: string[];
  testRunners: string[];
  estimate: AnalysisEstimate;
}

/** Everything the import screen shows, from a scan and a code graph of the source (no AI). */
export function importReport(scan: Scan, graph: Graph, size: PathSize = "standard"): ImportReport {
  const bytes = new Map(scan.files.map((f) => [f.path, f]));
  const graphFiles = new Map(graph.files.map((f) => [f.path, f]));
  // Same selection as loadSourceFiles: non-test source files in layer order, not flagged not-for-AI.
  const sent = graph.layers.flat().filter((path) => {
    const node = graphFiles.get(path);
    return node && !node.test && !bytes.get(path)?.notForAi;
  });

  const groups = new Map<ExclusionReason, string[]>();
  const add = (reason: ExclusionReason, path: string) => groups.set(reason, [...(groups.get(reason) ?? []), path]);
  for (const entry of scan.excluded) add(entry.reason === "secret" ? "secret" : "ignored", entry.path);
  for (const file of scan.files) if (file.notForAi) add(file.notForAi as ExclusionReason, file.path);

  const label = (id: string) => profiles[id]?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
  const languageLabel = (id: string) => ({ typescript: "TypeScript", javascript: "JavaScript", csharp: "C#" })[id] ?? label(id);
  return {
    files: scan.files.length,
    // Lines of code: lockfiles, binaries and huge generated files don't count.
    lines: scan.files.filter((f) => !f.notForAi).reduce((sum, f) => sum + f.lines, 0),
    filesSent: sent.length,
    filesExcluded: scan.excluded.length + scan.files.filter((f) => f.notForAi).length,
    excluded: REASONS.filter((r) => groups.has(r)).map((reason) => ({ reason, paths: groups.get(reason)! })),
    languages: scan.languages.map((l) => languageLabel(l.id)),
    frameworks: scan.frameworks.map((f) => (f.version ? `${label(f.profileId)} ${f.version.replace(/^[\^~]/, "")}` : label(f.profileId))),
    testRunners: [...new Set(scan.testRunners.map((r) => label(r.runner)))],
    estimate: estimateAnalysis(
      sent.map((path) => Math.ceil((bytes.get(path)?.bytes ?? 0) / 4)),
      behaviorCount(buildUnits(graph)),
      size,
    ),
  };
}
