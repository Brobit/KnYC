// The deployment track's checks (#100): deterministic, from the files a step introduces, no AI.
// A Dockerfile: the image builds, and the container answers on its health path when it exposes a
// port. A compose file: its services come up and their published ports answer. A GitHub Actions
// workflow: it is valid and runs npm scripts the project has.

import type { CheckSpec } from "../../schemas/check.ts";

export interface DeploymentCheck {
  label: string;
  spec: Extract<CheckSpec, { kind: "docker" | "compose" | "workflow" }>;
  timeoutMs: number;
}

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");

/**
 * The check for one deployment file, or null when it isn't one. `readyPath(folder)`: the path a
 * server of that folder's package answers on (the profile's), for a Dockerfile without a
 * HEALTHCHECK URL.
 */
export function deploymentCheck(path: string, language: string, content: string, readyPath: (folder: string) => string): DeploymentCheck | null {
  if (language === "dockerfile") {
    const folder = folderOf(path);
    // `COPY apps/api/package.json …`: the Dockerfile is built from the project root (a workspace).
    const context = folder !== "." && content.includes(`${folder}/`) ? "." : folder;
    const port = Number(content.match(/^\s*EXPOSE\s+(\d+)/im)?.[1]);
    const healthPath = content.match(/HEALTHCHECK[^\n]*?https?:\/\/[^/\s'"`]+(\/[^\s'"`)]*)/i)?.[1] ?? readyPath(folder);
    const run = Number.isInteger(port) && port > 0 ? { port, healthPath } : undefined;
    return {
      label: run ? `${path} builds, and the container answers on ${healthPath}` : `${path} builds`,
      spec: { kind: "docker", context, dockerfile: path, ...(run ? { run } : {}) },
      timeoutMs: 10 * 60_000,
    };
  }
  if (language !== "yaml") return null;
  if (/(^|\/)\.github\/workflows\//.test(path)) {
    return { label: `${path} is a valid workflow, and the npm scripts it runs exist`, spec: { kind: "workflow", file: path }, timeoutMs: 10_000 };
  }
  return { label: `${path}: the services come up, and their published ports answer`, spec: { kind: "compose", file: path }, timeoutMs: 15 * 60_000 };
}
