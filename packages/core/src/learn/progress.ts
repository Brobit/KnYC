// Moving through the path (#65, design/03 progress.json, design/04 §7 and decision F3): a passed
// step keeps its snapshot, the next one opens; a skipped step is marked and the original's code for
// it is applied so the project still builds (the learner's code is in a snapshot first). Every
// change is a pure function of progress.json; the app saves the result.

import type { LearningPath } from "../schemas/learning-path.ts";
import type { PathProgress, Progress, StepProgress } from "../schemas/progress.ts";
import type { FileChange } from "./hints.ts";

const fresh = (): StepProgress => ({ status: "locked", attempts: 0, hintsUsed: [], revealed: false, timeSpentSec: 0 });

function withPath(progress: Progress, pathId: string, change: (path: PathProgress) => PathProgress): Progress {
  const path = progress.paths[pathId];
  return path ? { ...progress, paths: { ...progress.paths, [pathId]: change(path) } } : progress;
}

function withSteps(progress: Progress, pathId: string, change: (steps: PathProgress["steps"]) => PathProgress["steps"]): Progress {
  return withPath(progress, pathId, (path) => ({ ...path, steps: change(path.steps) }));
}

/** The step after `stepId`, if any. */
export function nextStepOf(path: LearningPath, stepId: string) {
  const index = path.steps.findIndex((s) => s.id === stepId);
  return index < 0 ? undefined : path.steps[index + 1];
}

/** A passed step's snapshot (the learner's code at that point). */
export function withSnapshot(progress: Progress, pathId: string, stepId: string, snapshot: string): Progress {
  return withSteps(progress, pathId, (steps) => ({ ...steps, [stepId]: { ...(steps[stepId] ?? fresh()), snapshot } }));
}

/** Opens `stepId` as the current step (a locked one becomes available). */
export function withCurrentStep(progress: Progress, pathId: string, stepId: string, now: Date): Progress {
  return withPath(progress, pathId, (path) => {
    const step = path.steps[stepId] ?? fresh();
    const opened: StepProgress = { ...step, status: step.status === "locked" ? "available" : step.status, startedAt: step.startedAt ?? now.toISOString() };
    return { ...path, currentStepId: stepId, steps: { ...path.steps, [stepId]: opened } };
  });
}

/** The path is done: every step passed or skipped. */
export function withPathComplete(progress: Progress, pathId: string, now: Date): Progress {
  return withPath(progress, pathId, (path) => ({ ...path, completedAt: path.completedAt ?? now.toISOString() }));
}

/** Steps marked skipped (F3); their code comes from the original. */
export function withSkipped(progress: Progress, pathId: string, stepIds: string[]): Progress {
  return withSteps(progress, pathId, (steps) => {
    const next = { ...steps };
    for (const id of stepIds) if (next[id]?.status !== "passed") next[id] = { ...(next[id] ?? fresh()), status: "skipped" };
    return next;
  });
}

/** Adds time to a step (the workspace counts it while the window is in use). */
export function withTimeSpent(progress: Progress, pathId: string, stepId: string, seconds: number): Progress {
  return withSteps(progress, pathId, (steps) => {
    const step = steps[stepId] ?? fresh();
    return { ...steps, [stepId]: { ...step, timeSpentSec: Math.round(step.timeSpentSec + seconds) } };
  });
}

/** The steps a jump from `fromId` to `toId` skips: the current one and those in between. */
export function stepsSkippedBy(path: LearningPath, fromId: string, toId: string): string[] {
  const from = path.steps.findIndex((s) => s.id === fromId);
  const to = path.steps.findIndex((s) => s.id === toId);
  return from < 0 || to <= from ? [] : path.steps.slice(from, to).map((s) => s.id);
}

/**
 * What skipping writes into the workspace: each skipped step's changes in order, the last one
 * winning (null = the original removes the file).
 */
export function filesForSkip(changes: FileChange[][]): Map<string, string | null> {
  const files = new Map<string, string | null>();
  for (const step of changes) for (const change of step) files.set(change.path, change.after);
  return files;
}

export type StepState = "passed" | "skipped" | "current" | "locked";

/** Each step's state for the path map, from progress.json. */
export function stepStates(path: LearningPath, progress: PathProgress | undefined): Map<string, StepState> {
  return new Map(
    path.steps.map((step) => {
      const status = progress?.steps[step.id]?.status;
      const state: StepState = step.id === progress?.currentStepId ? "current" : status === "passed" ? "passed" : status === "skipped" ? "skipped" : "locked";
      return [step.id, state];
    }),
  );
}
