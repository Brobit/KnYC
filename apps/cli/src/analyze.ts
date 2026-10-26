// `knyc analyze`: the whole M1 pipeline on one project (design/02-analysis-pipeline.md ①–⑧).

import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  AiClient,
  behaviorCount,
  buildChecks,
  buildTimeline,
  classifyLeftovers,
  buildUnits,
  emptyUsage,
  estimateAnalysis,
  estimateTokens,
  extractContracts,
  FileCache,
  generatePlan,
  graphProject,
  loadSourceFiles,
  profileFor,
  projectFacts,
  scanProject,
  splitByRules,
  summarize,
  unitsForTrack,
  type PathSize,
  type TrackId,
} from "@knyc/core";
import { ClaudeCliProvider, NodeHost } from "@knyc/core/node";
import { renderReport, type StageStat } from "./report.ts";
import { initialProgress, projectDocument, writeWorkspace } from "./workspace.ts";

export interface AnalyzeOptions {
  folder: string;
  track: TrackId;
  size: PathSize;
  /** Where `.knyc/` is written. Default: the project folder itself. */
  workspace?: string;
  models: { summaries: string; planning: string; checks: string };
  /** Skip the confirmation after the estimate. */
  yes: boolean;
  /** Analysis cache root. Default: $KNYC_HOME or ~/.knyc. */
  home?: string;
}

export interface AnalyzeIo {
  log(line: string): void;
  confirm(question: string): Promise<boolean>;
}

export async function analyze(options: AnalyzeOptions, io: AnalyzeIo) {
  const source = resolve(options.folder);
  const workspace = resolve(options.workspace ?? source);
  const stages: StageStat[] = [];
  const stage = async <T>(name: string, run: () => Promise<T>, calls: () => number = () => 0): Promise<T> => {
    const started = Date.now();
    io.log(`→ ${name}…`);
    const before = calls();
    const result = await run();
    const seconds = (Date.now() - started) / 1000;
    stages.push({ name, seconds, calls: calls() - before });
    io.log(`  ✓ ${name} (${seconds.toFixed(1)} s)`);
    return result;
  };

  const host = new NodeHost();

  // ①–③ Local, no AI.
  const [scan, graph] = await stage("Scan and code graph", () => Promise.all([scanProject(host, source), graphProject(host, source)]));
  // The chosen track's units (#86): its rules first; leftovers are placed after the summaries.
  let split = splitByRules(scan, graph);
  let units = unitsForTrack(buildUnits(graph), split, options.track);
  const files = await loadSourceFiles(host, source, scan, graph);
  const facts = projectFacts(scan.root.split(/[\\/]/).pop()!, scan, graph);
  io.log(
    `  ${facts.languages.join(", ") || "no known language"} · ${facts.frameworks.join(", ") || "no framework detected"} · ${files.length} source files · ${units.atoms.length} units`,
  );
  if (units.atoms.length === 0) throw new Error("no source code found to learn from");

  // Estimate (design 02 D4).
  const { steps, calls, tokens } = estimateAnalysis(
    files.map((f) => estimateTokens(f.content)),
    behaviorCount(units),
    options.size,
  );
  const secrets = scan.excluded.filter((e) => e.reason === "secret").map((e) => e.path);
  io.log("");
  io.log(`Estimate for "${options.track}" at size "${options.size}" (about ${steps} steps):`);
  io.log(`  ${files.length} files sent to the AI · about ${calls} calls · about ${Math.round(tokens / 1000)}k tokens`);
  io.log(`  ${secrets.length > 0 ? `never sent (secrets): ${secrets.join(", ")}` : "no secret files found"}`);
  io.log(`  redacted lines: ${scan.secretLines.length}`);
  io.log(`  models: summaries ${options.models.summaries}, planning ${options.models.planning}, checks ${options.models.checks} (Claude Code CLI)`);
  if (!options.yes && !(await io.confirm("Start the analysis?"))) {
    io.log("Cancelled: nothing was sent to the AI.");
    return null;
  }
  io.log("");

  const home = resolve(options.home ?? process.env.KNYC_HOME ?? join(homedir(), ".knyc"));
  const cacheDir = join(home, "cache", scan.hash.replace(/^blake3:/, "").slice(0, 16));
  const role = (model: string) => ({ providerId: "claude-cli", model });
  const client = new AiClient({
    providers: [new ClaudeCliProvider()],
    roles: { summaries: role(options.models.summaries), planning: role(options.models.planning), lessons: role(options.models.checks) },
    cache: new FileCache(host, join(cacheDir, "ai")),
  });
  const aiCalls = () => client.totals.calls;

  // ⑤ Summaries.
  const { summaries } = await stage(
    "Summaries",
    () =>
      summarize(client, files, facts, {
        cache: new FileCache(host, join(cacheDir, "summaries")),
        cacheTag: `claude-cli:${options.models.summaries}`,
        onProgress: (done, total) => io.log(`  files ${done}/${total}`),
      }),
    aiCalls,
  );

  // ④ The track split: the AI places what the rules couldn't, then the contracts between tracks.
  split = await classifyLeftovers(client, split, summaries);
  split = { ...split, leftovers: [], contracts: extractContracts(new Map(files.map((f) => [f.path, f.content])), split) };
  units = unitsForTrack(buildUnits(graph), split, options.track);
  if (units.atoms.length === 0) throw new Error(`this project has no ${options.track} code to learn`);
  const otherTracks = options.track === "full" ? [] : split.contracts.filter((c) => c.track !== options.track);

  // ⑥ Plan.
  const { path } = await stage(
    "Learning path",
    () =>
      generatePlan(
        client,
        { track: options.track, size: options.size, units, summaries, profile: profileFor(facts.frameworks), hasTests: scan.testRunners.length > 0, otherTracks },
        { planning: role(options.models.planning), onRetry: (p) => io.log(`  retry: ${p.length} problems (${p[0]})`) },
      ),
    aiCalls,
  );
  io.log(`  ${path.steps.length} steps in ${path.milestones.length} milestones`);

  // ⑦ Reference timeline.
  const workDir = join(cacheDir, "timeline", path.id);
  await rm(workDir, { recursive: true, force: true });
  const timeline = await stage("Reference timeline", () =>
    buildTimeline(path, graph, scan, units, {
      host,
      sourceRoot: source,
      workDir,
      onStep: (s) => io.log(`  ${s.stepId} ${s.ok ? "builds" : `doesn't build alone → merged into ${s.mergedInto}`}`),
    }),
  );

  // ⑧ Checks.
  const checks = await stage(
    "Checks",
    () => buildChecks(path, timeline, graph, scan, { host, sourceRoot: source, client, units, onProgress: (m) => io.log(`  ${m}`) }),
    aiCalls,
  );

  const now = new Date();
  const strong = checks.report.filter((r) => r.strength === "strong").length;
  const report = renderReport({
    projectName: facts.name,
    path: checks.path,
    timeline,
    checks: checks.checks,
    stepChecks: checks.report,
    stages,
    usage: client.totals.usage ?? emptyUsage(),
    costUsd: client.totals.costUsd,
    models: options.models,
  });
  const written = await writeWorkspace(workspace, {
    project: projectDocument({ path: source, hash: scan.hash }, scan, units, options.track, now),
    path: checks.path,
    checks: checks.checks,
    checkFiles: checks.files,
    progress: initialProgress(checks.path, now),
    report,
  });

  io.log("");
  io.log(`Done: ${checks.path.steps.length} steps, ${strong}/${checks.report.length} with a proven check, ${client.totals.calls} AI calls.`);
  io.log(`Wrote ${written.length} files in ${join(workspace, ".knyc")} (report: .knyc/report.md).`);
  return {
    path: checks.path,
    report: checks.report,
    checks: checks.checks,
    checkFiles: checks.files,
    timeline,
    stages,
    totals: client.totals,
    units: units.atoms.length,
    written,
    cacheDir,
    workDir,
  };
}
