// Writes the learner's workspace metadata, `.knyc/` (design/03-data-model.md). The documents
// themselves come from core (shared with the app).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  check as checkSchema,
  learningPath,
  progress as progressSchema,
  project as projectSchema,
  type Check,
  type LearningPath,
  type Progress,
  type Project,
} from "@knyc/core";

export { initialProgress, projectDocument } from "@knyc/core";

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
