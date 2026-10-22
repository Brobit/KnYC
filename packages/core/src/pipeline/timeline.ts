// Stage ⑦ (design/02-analysis-pipeline.md): the reference timeline. For every step k, R_k is the
// original project keeping only the units introduced up to step k. Every R_k must build; each one
// is a commit tagged `<pathId>/sNN` in a git repository (design 03: reference.git).

import { joinPath, type Host } from "../host/host.ts";
import type { LearningPath } from "../schemas/learning-path.ts";
import { intakeProject, runCommand, type Graph, type Scan } from "../sys/knyc-sys.ts";
import { placeUnits, type PlanAnswer } from "./plan.ts";
import { withNodeTypes } from "./setup.ts";
import { sliceSource, type SliceContext } from "./slice.ts";
import type { Units } from "./units.ts";


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
          checkStrategy: step.checkStrategy ?? "build",
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
  const sourceFiles = new Set(units.byFile.keys());
  const tests = new Set(graph.files.filter((f) => f.test).map((f) => f.path));
  const ctx: SliceContext = {
    fileExists: (path) =>
      sourceFiles.has(path) ? units.byFile.get(path)!.some((id) => keep.has(id)) : !tests.has(path),
    symbolExists: (path, name) => {
      if (units.byId.get(path)?.kind === "file") return keep.has(path);
      const id = `${path}#${name}`;
      return units.byId.has(id) ? keep.has(id) : undefined;
    },
  };

  const files = new Map<string, string | null>();
  for (const file of graph.files) {
    if (file.test || !sourceFiles.has(file.path)) continue;
    const atoms = units.byFile.get(file.path)!.map((id) => units.byId.get(id)!);
    files.set(file.path, sliceSource(await read(file.path), file, atoms, keep, ctx));
  }
  return files;
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
  const commands = scan.commands[0];
  if (!commands?.build) throw new Error("the project has no build command; the timeline can't be checked");

  // A private copy of the project (no secrets, no node_modules), with its dependencies installed.
  await intakeProject(host, options.sourceRoot, options.workDir);
  if (commands.install) {
    const install = await runCommand(host, options.workDir, commands.install, { timeoutMs: options.installTimeoutMs ?? 10 * 60_000 });
    if (install.status !== "pass") throw new Error(`installing dependencies failed:\n${tail(install.run?.stderr ?? install.error ?? "")}`);
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
    const build = await runCommand(host, options.workDir, commands.build, { timeoutMs: options.buildTimeoutMs ?? 5 * 60_000 });
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
