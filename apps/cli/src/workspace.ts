// Writes the learner's workspace metadata, `.knyc/` (design/03-data-model.md).

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  check as checkSchema,
  learningPath,
  progress as progressSchema,
  project as projectSchema,
  type Check,
  type LearningPath,
  type Progress,
  type Project,
  type Scan,
  type TrackId,
  type Units,
} from "@knyc/core";

const LANGUAGES = new Set(["typescript", "javascript", "python", "go", "csharp", "html", "css"]);
const TOOLCHAINS = new Set(["node", "python", "go", "dotnet", "docker"]);

/** project.json from the scan, the units and the track. */
export function projectDocument(source: string, scan: Scan, units: Units, track: TrackId, now: Date): Project {
  const excluded: Project["excluded"] = [
    ...scan.excluded.map((e) => ({ path: e.path, reason: e.reason === "secret" ? ("secret" as const) : ("ignored" as const) })),
    ...scan.files
      .filter((f) => f.notForAi === "binary" || f.notForAi === "too-large")
      .map((f) => ({ path: f.path, reason: f.notForAi as "binary" | "too-large" })),
  ];
  return projectSchema.parse({
    schemaVersion: 1,
    id: basename(source).toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    name: basename(source),
    source: { path: source, hash: scan.hash },
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

export interface WorkspaceDocuments {
  project: Project;
  path: LearningPath;
  checks: Check[];
  /** Generated check files: path relative to the project → code. */
  checkFiles: Map<string, string>;
  progress: Progress;
  report: string;
}

/** Writes everything under `<workspace>/.knyc/`, validating each document first. */
export async function writeWorkspace(workspace: string, docs: WorkspaceDocuments): Promise<string[]> {
  const root = join(workspace, ".knyc");
  const written: string[] = [];
  const put = async (relative: string, content: string) => {
    const target = join(root, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    written.push(join(".knyc", relative));
  };
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

  await put("project.json", json(projectSchema.parse(docs.project)));
  await put(`paths/${docs.path.id}.json`, json(learningPath.parse(docs.path)));
  for (const c of docs.checks) await put(`checks/${docs.path.id}/${c.id}.json`, json(checkSchema.parse(c)));
  // Generated check files live with the checks, copied into the project only while they run.
  for (const [file, code] of docs.checkFiles) await put(`checks/${docs.path.id}/files/${file}`, code);
  await put("progress.json", json(progressSchema.parse(docs.progress)));
  await put("report.md", docs.report);
  return written;
}
