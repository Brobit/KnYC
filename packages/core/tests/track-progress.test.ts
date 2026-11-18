import { describe, expect, it } from "vitest";
import {
  initialProgress,
  learningPath,
  readProgress,
  startWorkspace,
  trackFiles,
  trackOfPath,
  trackProgress,
  withCurrentStep,
  withPathComplete,
  withSnapshot,
  writeProgress,
  type LearningPath,
  type WorkspaceFiles,
} from "../src/index.ts";
import { clone, pathExample } from "./examples.ts";

// Progress per track (#101): a finished track's code stays when the learner starts another one.

const memory = (initial: Record<string, string>) => {
  const files = new Map(Object.entries(initial));
  const workspace: WorkspaceFiles = {
    read: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`no ${path}`);
      return content;
    },
    write: async (path, content) => void files.set(path, content),
    remove: async (path) => void files.delete(path),
    exists: async (path) => files.has(path),
  };
  return { files, workspace };
};

const path = (id: string, trackId: "frontend" | "backend", steps: { id: string; units: string[] }[]): LearningPath =>
  learningPath.parse({
    ...clone(pathExample),
    id,
    trackId,
    size: "standard",
    milestones: [{ id: "m1", title: "All", summary: "All of it.", stepIds: steps.map((s) => s.id) }],
    steps: steps.map((s, i) => ({
      id: s.id,
      index: i,
      title: `Step ${i + 1}`,
      goal: "Write it.",
      introduces: s.units.map((unit) => ({ unit, kind: unit.includes("#") ? "function" : "file", change: "add" })),
      estimatedMinutes: 10,
    })),
  });

const backend = path("backend-standard", "backend", [
  { id: "s01", units: ["apps/api/src/notes.store.ts#NotesStore"] },
  { id: "s02", units: ["apps/api/src/app.ts#createApp", "apps/api/src/server.ts"] },
]);
const frontend = path("frontend-standard", "frontend", [
  { id: "s01", units: ["apps/web/src/api.ts#fetchNotes"] },
  { id: "s02", units: ["apps/web/src/App.tsx#App", "apps/web/src/main.tsx"] },
]);

describe("progress per track (#101)", () => {
  it("marks a finished path's track done, with its last snapshot", () => {
    let progress = initialProgress(backend, new Date("2026-11-18T09:00:00Z"));
    progress = withSnapshot(progress, backend.id, "s01", "c1");
    progress = withSnapshot(progress, backend.id, "s02", "c2");
    expect(trackProgress(progress).get("backend")).toEqual({ pathId: "backend-standard", status: "in-progress", passed: 0, total: 2 });
    const done = withPathComplete(progress, backend.id, new Date("2026-11-18T10:00:00Z"));
    expect(done.tracksDone).toEqual([{ trackId: "backend", pathId: "backend-standard", snapshot: "c2" }]);
    expect(trackProgress(done).get("backend")?.status).toBe("done");
    expect(trackOfPath("frontend-deep-setup")).toBe("frontend");
  });

  it("starts the frontend after the backend on the learner's own backend (Done when)", async () => {
    // The backend track is done: the learner's API, the original web app (it came with R₀).
    const { files, workspace } = memory({
      ".knyc/project.json": "{}",
      "package.json": '{"workspaces":["apps/api","apps/web"]}',
      "apps/api/src/app.ts": "// the learner's createApp\n",
      "apps/api/src/server.ts": "// the learner's server\n",
      "apps/web/package.json": "{}",
      "apps/web/src/api.ts": "export function fetchNotes() {}\n",
      "apps/web/src/App.tsx": "export function App() {}\n",
      "apps/web/src/main.tsx": "// mounts App\n",
    });
    const started = withCurrentStep(withPathComplete(initialProgress(backend, new Date()), backend.id, new Date()), backend.id, "s02", new Date());
    await writeProgress(workspace, started);

    // The frontend's R₀: the original API, the web app's setup, no web code.
    const setup = new Map([
      ["package.json", '{"workspaces":["apps/api","apps/web"]}'],
      ["apps/api/src/app.ts", "// the original createApp\n"],
      ["apps/api/src/server.ts", "// the original server\n"],
      ["apps/web/package.json", "{}"],
    ]);
    const snapshots: string[] = [];
    await startWorkspace(workspace, { project: {} as never, path: frontend, setup, now: new Date() }, async () => void snapshots.push("before"));

    expect(snapshots).toEqual(["before"]);
    expect(files.get("apps/api/src/app.ts")).toBe("// the learner's createApp\n");
    expect(files.get("apps/api/src/server.ts")).toBe("// the learner's server\n");
    expect(files.has("apps/web/src/api.ts")).toBe(false);
    expect(files.has("apps/web/src/App.tsx")).toBe(false);
    expect(files.has("apps/web/src/main.tsx")).toBe(false);
    expect([...trackFiles(frontend)]).toEqual(["apps/web/src/api.ts", "apps/web/src/App.tsx", "apps/web/src/main.tsx"]);

    const progress = (await readProgress(workspace))!;
    expect(progress.activePathId).toBe("frontend-standard");
    expect(trackProgress(progress).get("backend")?.status).toBe("done");
    expect(trackProgress(progress).get("frontend")).toEqual({ pathId: "frontend-standard", status: "in-progress", passed: 0, total: 2 });
  });

  it("leaves a path already started in the workspace as it is", async () => {
    const { files, workspace } = memory({ ".knyc/project.json": "{}", "apps/web/src/api.ts": "// mine\n" });
    await writeProgress(workspace, initialProgress(frontend, new Date()));
    let called = false;
    await startWorkspace(workspace, { project: {} as never, path: frontend, setup: new Map(), now: new Date() }, async () => void (called = true));
    expect(called).toBe(false);
    expect(files.get("apps/web/src/api.ts")).toBe("// mine\n");
  });
});
