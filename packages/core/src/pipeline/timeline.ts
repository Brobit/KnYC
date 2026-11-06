// Stage ⑦ (design/02-analysis-pipeline.md): the reference timeline. For every step k, R_k is the
// original project keeping only the units introduced up to step k. Every R_k must build; each one
// is a commit tagged `<pathId>/sNN` in a git repository (design 03: reference.git).

import { joinPath, type Host } from "../host/host.ts";
import type { LearningPath } from "../schemas/learning-path.ts";
import { intakeProject, runCommand, type Graph, type Scan } from "../sys/knyc-sys.ts";
import { builds, installs, packageCommands } from "./packages.ts";
import { placeUnits, type PlanAnswer } from "./plan.ts";
import { withNodeTypes } from "./setup.ts";
import { sliceSource, type SliceContext } from "./slice.ts";
import type { Units } from "./units.ts";
import { buildAll } from "./workspace.ts";


/** Unit id → index of the step that introduces it, for a stored LearningPath. */
export function stepOfUnits(path: LearningPath, units: Units): Map<string, number> {
  const answer: PlanAnswer = {
    milestones: path.milestones.map((m) => ({
      title: m.title,
      summary: m.summary,
      steps: m.stepIds.map((id) => {
        const step = path.steps.find((s) => s.id === id)!;
        return {
          title: step.title,
          goal: step.goal,
          concepts: step.concepts,
          introduces: step.introduces.map((u) => u.unit),
          // Placing units doesn't read the strategy; "ui" isn't one the planner offers (#89).
          checkStrategy: !step.checkStrategy || step.checkStrategy === "ui" ? "build" : step.checkStrategy,
          estimatedMinutes: step.estimatedMinutes,
        };
      }),
    })),
  };
  const { stepOf, problems } = placeUnits(answer, units, { min: 1, max: Number.MAX_SAFE_INTEGER });
  if (problems.length > 0) throw new Error(`the path doesn't fit this code:\n- ${problems.join("\n- ")}`);
  return stepOf;
}

/**
 * Source files at step k: path → content, or null when the file doesn't exist yet.
 * `read` returns a file's original content.
 */
export async function filesAtStep(
  k: number,
  graph: Graph,
  units: Units,
  stepOf: Map<string, number>,
  read: (path: string) => Promise<string>,
): Promise<Map<string, string | null>> {
  const keep = new Set([...stepOf].filter(([, at]) => at <= k).map(([id]) => id));
  // Other tracks' code held back until the track's units it uses exist (#98); the rest of those
  // files is there from the start.
  const held = units.held;
  for (const [id, waits] of held?.waitsFor ?? []) if ([...waits].every((w) => keep.has(w))) keep.add(id);
  for (const id of held?.byId.keys() ?? []) if (!held!.waitsFor.has(id)) keep.add(id);
  const byFile = new Map([...(held?.byFile ?? []), ...units.byFile]);
  const byId = new Map([...(held?.byId ?? []), ...units.byId]);

  const sourceFiles = new Set(byFile.keys());
  const tests = new Set(graph.files.filter((f) => f.test).map((f) => f.path));
  const ctx: SliceContext = {
    fileExists: (path) =>
      sourceFiles.has(path) ? byFile.get(path)!.some((id) => keep.has(id)) : !tests.has(path),
    symbolExists: (path, name) => {
      if (byId.get(path)?.kind === "file") return keep.has(path);
      const id = `${path}#${name}`;
      return byId.has(id) ? keep.has(id) : undefined;
    },
  };

  const files = new Map<string, string | null>();
  for (const file of graph.files) {
    if (file.test || !sourceFiles.has(file.path)) continue;
    const atoms = byFile.get(file.path)!.map((id) => byId.get(id)!);
    files.set(file.path, sliceSource(await read(file.path), file, atoms, keep, ctx));
  }
  await sliceDrizzleJournals(graph, files, read);
  return files;
}

/**
 * Drizzle (#99): the migrator applies what `meta/_journal.json` lists, and drizzle-kit diffs the
 * schema against the last snapshot. At a step, the journal lists the migrations the step has, and
 * the snapshots of later ones are gone.
 */
async function sliceDrizzleJournals(graph: Graph, files: Map<string, string | null>, read: (path: string) => Promise<string>) {
  const folders = new Set(graph.files.filter((f) => f.language === "sql").map((f) => f.path.slice(0, f.path.lastIndexOf("/") + 1)));
  for (const folder of folders) {
    const journalPath = `${folder}meta/_journal.json`;
    const original = await read(journalPath).catch(() => null);
    let journal: { entries?: { idx: number; tag: string }[] } | null = null;
    try {
      journal = original === null ? null : JSON.parse(original);
    } catch {
      // Not a drizzle-kit journal: leave it alone.
    }
    if (original === null || !journal || !Array.isArray(journal.entries)) continue;
    const entries = journal.entries;
    const present = entries.filter((e) => files.get(`${folder}${e.tag}.sql`) !== null);
    if (present.length === entries.length) {
      files.set(journalPath, original);
      continue;
    }
    files.set(journalPath, `${JSON.stringify({ ...journal, entries: present }, null, 2)}\n`);
    for (const entry of entries.filter((e) => !present.includes(e))) files.set(`${folder}meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`, null);
  }
}

export interface StepBuild {
  stepId: string;
  /** The step's R_k builds. */
  ok: boolean;
  /** Steps that couldn't build are merged into the next one (design 02 ⑦): no tag of their own. */
  mergedInto?: string;
  tag?: string;
  commit?: string;
  durationMs: number;
  /** Last lines of the build output when it failed. */
  errors?: string;
}

export interface Timeline {
  pathId: string;
  workDir: string;
  steps: StepBuild[];
  /** The last step reproduces every original source file exactly. */
  finalMatchesOriginal: boolean;
  /** Changes made to the setup so early steps build alone ("tsconfig.json: types node"). */
  setupFixes: string[];
}

export interface TimelineOptions {
  host: Host;
  /** Original project (read only). */
  sourceRoot: string;
  /** Where the timeline repository is created; must not exist or be empty. */
  workDir: string;
  installTimeoutMs?: number;
  buildTimeoutMs?: number;
  onStep?: (build: StepBuild) => void;
}

async function writeFiles(host: Host, workDir: string, files: Map<string, string | null>) {
  for (const [path, content] of files) {
    const target = joinPath(workDir, path);
    if (content === null) await host.remove(target);
    else await host.writeFile(target, content);
  }
}

const tail = (text: string, lines = 30) => text.trim().split("\n").slice(-lines).join("\n");

/** Applies the setup fixes (setup.ts) to the working copy; returns what changed. */
async function fixSetup(host: Host, workDir: string): Promise<string[]> {
  const fixes: string[] = [];
  const tsconfigPath = joinPath(workDir, "tsconfig.json");
  const tsconfig = await host.readFile(tsconfigPath).catch(() => null);
  const pkg = await host.readFile(joinPath(workDir, "package.json")).then(JSON.parse, () => null);
  if (tsconfig !== null && pkg) {
    const fixed = withNodeTypes(tsconfig, pkg);
    if (fixed !== null) {
      await host.writeFile(tsconfigPath, fixed);
      fixes.push('tsconfig.json: added "types": ["node"]');
    }
  }
  return fixes;
}

export async function buildTimeline(path: LearningPath, graph: Graph, scan: Scan, units: Units, options: TimelineOptions): Promise<Timeline> {
  const { host } = options;
  const stepOf = stepOfUnits(path, units);
  const commands = packageCommands(scan);
  if (builds(commands).length === 0) throw new Error("the project has no build command; the timeline can't be checked");

  // A private copy of the project (no secrets, no node_modules), with its dependencies installed,
  // package by package (once at a workspace's root, #87).
  await intakeProject(host, options.sourceRoot, options.workDir);
  for (const { root, command } of installs(commands)) {
    const dir = root === "." ? options.workDir : joinPath(options.workDir, root);
    const install = await runCommand(host, dir, command, { timeoutMs: options.installTimeoutMs ?? 10 * 60_000 });
    if (install.status !== "pass") throw new Error(`installing dependencies${root === "." ? "" : ` in ${root}`} failed:\n${tail(install.run?.stderr ?? install.error ?? "")}`);
  }

  const git = (...args: string[]) => host.git(options.workDir, args);
  await git("init", "-q");
  await git("config", "user.name", "KnYC");
  await git("config", "user.email", "knyc@localhost");
  await git("config", "core.autocrlf", "false");
  await host.appendFile(joinPath(options.workDir, ".git", "info", "exclude"), "node_modules/\ndist/\nbuild/\ncoverage/\n.knyc-*\n");

  const setupFixes = await fixSetup(host, options.workDir);

  // Tests are checks (stage ⑧), never part of R_k.
  for (const file of graph.files.filter((f) => f.test)) await host.remove(joinPath(options.workDir, file.path));

  const read = (p: string) => host.readFile(joinPath(options.sourceRoot, p));
  const commit = async (message: string, tag: string) => {
    await git("add", "-A");
    await git("commit", "-q", "--allow-empty", "-m", message);
    await git("tag", "-f", tag);
    return git("rev-parse", "HEAD");
  };

  // R_0: the setup only (package.json, tsconfig…), no source code yet.
  await writeFiles(host, options.workDir, await filesAtStep(-1, graph, units, stepOf, read));
  await commit(`${path.id}: setup`, `${path.id}/s00`);

  const steps: StepBuild[] = [];
  for (const [k, step] of path.steps.entries()) {
    const started = Date.now();
    await writeFiles(host, options.workDir, await filesAtStep(k, graph, units, stepOf, read));
    const build = await buildAll(host, options.workDir, commands, options.buildTimeoutMs ?? 5 * 60_000);
    const ok = build.status === "pass";
    const result: StepBuild = { stepId: step.id, ok, durationMs: Date.now() - started };
    const isLast = k === path.steps.length - 1;

    if (ok || isLast) {
      result.tag = `${path.id}/${step.id}`;
      result.commit = await commit(`${path.id}: ${step.id} ${step.title}`, result.tag);
    } else {
      result.mergedInto = path.steps[k + 1]!.id;
    }
    if (!ok) result.errors = tail(`${build.run?.stdout ?? ""}\n${build.run?.stderr ?? ""}${build.error ?? ""}`);
    steps.push(result);
    options.onStep?.(result);
  }

  let finalMatchesOriginal = true;
  for (const file of graph.files.filter((f) => !f.test && units.byFile.has(f.path))) {
    const built = await host.readFile(joinPath(options.workDir, file.path)).catch(() => null);
    if (built !== (await read(file.path))) finalMatchesOriginal = false;
  }

  return { pathId: path.id, workDir: options.workDir, steps, finalMatchesOriginal, setupFixes };
}
