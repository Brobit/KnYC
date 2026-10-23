// The learner's workspace metadata, `.knyc/` (design/03-data-model.md): where each document lives,
// and the project and progress documents a new workspace starts with. Shared by the CLI and the app.

import type { Units } from "../pipeline/units.ts";
import type { TrackId } from "../schemas/common.ts";
import type { LearningPath } from "../schemas/learning-path.ts";
import { progress as progressSchema, type Progress } from "../schemas/progress.ts";
import { project as projectSchema, type Project } from "../schemas/project.ts";
import type { Scan } from "../sys/knyc-sys.ts";

const LANGUAGES = new Set(["typescript", "javascript", "python", "go", "csharp", "html", "css"]);
const TOOLCHAINS = new Set(["node", "python", "go", "dotnet", "docker"]);

export const PROJECT_FILE = ".knyc/project.json";
export const PROGRESS_FILE = ".knyc/progress.json";

/** Paths inside the workspace, relative to its root. */
export function knycPaths(pathId: string) {
  return {
    project: PROJECT_FILE,
    progress: PROGRESS_FILE,
    path: `.knyc/paths/${pathId}.json`,
    check: (checkId: string) => `.knyc/checks/${pathId}/${checkId}.json`,
    /** Generated test files, copied into the project only while their check runs. */
    checkFile: (file: string) => `.knyc/checks/${pathId}/files/${file}`,
    /** The project's own test files, for checks that run its suite (same rule). */
    testFile: (file: string) => `.knyc/checks/${pathId}/tests/${file}`,
    lesson: (stepId: string) => `.knyc/lessons/${pathId}/${stepId}.json`,
    runs: (stepId: string) => `.knyc/runs/${pathId}/${stepId}.jsonl`,
  };
}

/** project.json from the scan, the units and the track. `source.hash` names the analysis cache. */
export function projectDocument(source: { path: string; hash: string; name?: string }, scan: Scan, units: Units, track: TrackId, now: Date): Project {
  const name = source.name ?? source.path.split(/[\\/]/).filter(Boolean).pop() ?? "project";
  const excluded: Project["excluded"] = [
    ...scan.excluded.map((e) => ({ path: e.path, reason: e.reason === "secret" ? ("secret" as const) : ("ignored" as const) })),
    ...scan.files
      .filter((f) => f.notForAi === "binary" || f.notForAi === "too-large")
      .map((f) => ({ path: f.path, reason: f.notForAi as "binary" | "too-large" })),
  ];
  return projectSchema.parse({
    schemaVersion: 1,
    id: name.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    name,
    source: { path: source.path, hash: source.hash },
    createdAt: now.toISOString(),
    languages: scan.languages.filter((l) => LANGUAGES.has(l.id)).map((l) => ({ id: l.id, loc: l.loc })),
    frameworks: scan.frameworks.map((f) => ({ profileId: f.profileId, root: f.root, ...(f.version ? { version: f.version } : {}) })),
    toolchains: scan.toolchains
      .filter((t) => TOOLCHAINS.has(t.id))
      .map((t) => ({ id: t.id, required: t.required, ...(t.found ? { found: t.found } : {}) })),
    commands: scan.commands.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null))),
    tracks: [
      {
        id: track,
        label: track[0]!.toUpperCase() + track.slice(1),
        units: units.atoms.map((a) => a.id),
        loc: units.atoms.reduce((sum, a) => sum + a.lines, 0),
      },
    ],
    excluded,
  });
}

export function initialProgress(path: LearningPath, now: Date): Progress {
  const first = path.steps[0]!.id;
  return progressSchema.parse({
    schemaVersion: 1,
    activePathId: path.id,
    paths: {
      [path.id]: {
        currentStepId: first,
        startedAt: now.toISOString(),
        steps: Object.fromEntries(path.steps.map((s) => [s.id, { status: s.id === first ? "available" : "locked" }])),
      },
    },
  });
}
