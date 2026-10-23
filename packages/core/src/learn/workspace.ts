// The learner's workspace for a chosen path (#62, design/02 "Starting the learner's workspace"):
// it starts as R₀, the project's setup without its source code, with `.knyc/` holding the path,
// the checks of the steps prepared so far and the progress. Steps prepared later (design/02 D5)
// are added by `syncPreparedSteps` as they become ready.

import type { Host } from "../host/host.ts";
import { check as checkSchema, type Check } from "../schemas/check.ts";
import { learningPath, type LearningPath } from "../schemas/learning-path.ts";
import { progress as progressSchema, type Progress } from "../schemas/progress.ts";
import { project as projectSchema, type Project } from "../schemas/project.ts";
import type { WorkspaceFiles } from "./checks.ts";
import { initialProgress, knycPaths, PROGRESS_FILE } from "./documents.ts";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The files of the reference timeline at `tag`, read from git objects: the working copy isn't
 * touched, since the checks of later steps may be using it at the same time.
 */
export async function referenceFiles(host: Host, workDir: string, tag: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const list = (await host.git(workDir, ["ls-tree", "-r", "--name-only", tag])).split("\n").filter(Boolean);
  for (const file of list) files.set(file, await host.git(workDir, ["show", `${tag}:${file}`]));
  return files;
}

export interface WorkspaceStart {
  project: Project;
  path: LearningPath;
  /** R₀: the setup files the learner starts from (package.json, tsconfig…). */
  setup: Map<string, string>;
  now: Date;
}

/**
 * Writes a new workspace: the setup, project.json, the path and the progress. An existing KnYC
 * workspace keeps its code and progress; only the path document is refreshed.
 */
export async function startWorkspace(files: WorkspaceFiles, start: WorkspaceStart): Promise<void> {
  const paths = knycPaths(start.path.id);
  if (!(await files.exists(paths.project))) {
    for (const [file, content] of start.setup) await files.write(file, content);
    await files.write(paths.project, json(projectSchema.parse(start.project)));
  }
  await files.write(paths.path, json(learningPath.parse(start.path)));
  const progress = await readProgress(files);
  if (!progress?.paths[start.path.id]) {
    const fresh = initialProgress(start.path, start.now);
    await writeProgress(files, progress ? { ...progress, activePathId: start.path.id, paths: { ...progress.paths, ...fresh.paths } } : fresh);
  }
}

export async function readProgress(files: WorkspaceFiles): Promise<Progress | null> {
  const file = PROGRESS_FILE;
  if (!(await files.exists(file))) return null;
  return progressSchema.parse(JSON.parse(await files.read(file)));
}

export const writeProgress = (files: WorkspaceFiles, progress: Progress) => files.write(PROGRESS_FILE, json(progressSchema.parse(progress)));

export interface PreparedStepChecks {
  checks: Check[];
  /** Generated test files: path in the project → code. */
  files: Map<string, string>;
}

/**
 * Copies into `.knyc/` what the job has prepared since: the path (steps marked ready), the checks
 * of each ready step not copied yet, and once the project's own tests (when steps use them).
 * Returns the steps added.
 */
export async function syncPreparedSteps(
  files: WorkspaceFiles,
  path: LearningPath,
  load: (stepId: string) => Promise<PreparedStepChecks | undefined>,
  testFiles?: () => Promise<Map<string, string>>,
): Promise<string[]> {
  const paths = knycPaths(path.id);
  await files.write(paths.path, json(learningPath.parse(path)));
  const added: string[] = [];
  for (const step of path.steps) {
    if (step.prep !== "checks-ready" && step.prep !== "ready") continue;
    const first = step.checkIds[0];
    if (!first || (await files.exists(paths.check(first)))) continue;
    const prepared = await load(step.id);
    if (!prepared) continue;
    for (const [file, code] of prepared.files) await files.write(paths.checkFile(file), code);
    if (prepared.checks.some((c) => c.origin === "repo") && testFiles && !(await files.exists(paths.testFile("index.json")))) {
      const tests = await testFiles();
      for (const [file, code] of tests) await files.write(paths.testFile(file), code);
      await files.write(paths.testFile("index.json"), json([...tests.keys()]));
    }
    // The check documents last: their presence says the step is copied.
    for (const check of prepared.checks) await files.write(paths.check(check.id), json(checkSchema.parse(check)));
    added.push(step.id);
  }
  return added;
}

/** A step's checks as copied into `.knyc/` (empty while the step is still being prepared). */
export async function workspaceStepChecks(files: WorkspaceFiles, path: LearningPath, stepId: string): Promise<Check[]> {
  const step = path.steps.find((s) => s.id === stepId);
  const paths = knycPaths(path.id);
  const checks: Check[] = [];
  for (const id of step?.checkIds ?? []) {
    if (!(await files.exists(paths.check(id)))) return [];
    checks.push(checkSchema.parse(JSON.parse(await files.read(paths.check(id)))));
  }
  return checks;
}

/** The project's test files stored for the suite checks. */
export async function storedTestFiles(files: WorkspaceFiles, pathId: string): Promise<string[]> {
  const index = knycPaths(pathId).testFile("index.json");
  return (await files.exists(index)) ? (JSON.parse(await files.read(index)) as string[]) : [];
}
