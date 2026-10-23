// An in-memory workspace for `pnpm dev` in a plain browser and for tests: same API and same errors
// as the Rust commands, so the UI can be built and checked without the desktop app.
import { WorkspaceFsError, type TreeEntry, type WorkspaceFs, type WorkspaceInfo } from "./workspace-fs-types";

type Node = { kind: "dir" } | { kind: "file"; content: string };

const SAMPLE: Record<string, string> = {
  "package.json": '{\n  "name": "express-notes",\n  "type": "module",\n  "scripts": { "start": "node src/server.js" }\n}\n',
  "README.md": "# express-notes\n\nA tiny notes API.\n",
  ".gitignore": "node_modules/\n",
  "src/server.js": 'import { app } from "./app.js";\n\napp.listen(3000);\n',
  "src/app.js": 'import express from "express";\nimport { notes } from "./routes/notes.js";\n\nexport const app = express();\napp.use("/notes", notes);\n',
  "src/routes/notes.js": 'import { Router } from "express";\n\nexport const notes = Router();\n',
  "src/store.js": "export const store = new Map();\n",
  "test/notes.test.js": 'import test from "node:test";\n',
};

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export function createFakeWorkspaceFs(files: Record<string, string> = SAMPLE, name = "express-notes"): WorkspaceFs {
  const nodes = new Map<string, Node>();
  const listeners = new Set<(paths: string[]) => void>();
  let open = false;

  const addFile = (path: string, content: string) => {
    for (let dir = parentOf(path); dir; dir = parentOf(dir)) nodes.set(dir, { kind: "dir" });
    nodes.set(path, { kind: "file", content });
  };
  for (const [path, content] of Object.entries(files)) addFile(path, content);

  const changed = (...paths: string[]) => setTimeout(() => listeners.forEach((l) => l(paths)), 20);

  /** Same rules as Scope::resolve: relative, no "..", parent must exist. */
  const resolve = (path: string, { child = true } = {}) => {
    if (!open) throw new WorkspaceFsError("noWorkspace", "no folder is open");
    const parts = path.split("/").filter((p) => p && p !== ".");
    if (path.startsWith("/") || /^[a-zA-Z]:/.test(path) || parts.includes("..")) throw new WorkspaceFsError("outsideWorkspace", path);
    const clean = parts.join("/");
    if (child && !clean) throw new WorkspaceFsError("outsideWorkspace", path);
    const parent = parentOf(clean);
    if (parent && nodes.get(parent)?.kind !== "dir") throw new WorkspaceFsError("notFound", path);
    return clean;
  };
  const existing = (path: string) => {
    const node = nodes.get(path);
    if (!node) throw new WorkspaceFsError("notFound", path);
    return node;
  };
  const children = (dir: string): TreeEntry[] =>
    [...nodes.entries()]
      .filter(([path]) => parentOf(path) === dir && path !== dir)
      .map(([path, node]) => ({ path, kind: node.kind }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));

  let info: WorkspaceInfo = { root: `/fake/${name}`, name };
  const run = async <T>(action: () => T): Promise<T> => action();

  return {
    pick: () => run(() => ((open = true), info)),
    open: () => run(() => ((open = true), info)),
    // A new learner workspace (#62): an empty folder, like the Rust command makes.
    create: (root) =>
      run(() => {
        nodes.clear();
        open = true;
        info = { root, name: root.split(/[\/]/).filter(Boolean).pop() ?? root };
        return info;
      }),
    close: () => run(() => void (open = false)),
    exists: (path) =>
      run(() => {
        try {
          return nodes.has(resolve(path));
        } catch (error) {
          if (error instanceof WorkspaceFsError && error.kind === "notFound") return false;
          throw error;
        }
      }),
    tree: () => run(() => (resolve("", { child: false }), [...nodes.keys()].sort().map((path) => ({ path, kind: nodes.get(path)!.kind })))),
    list: (dir) =>
      run(() => {
        const clean = resolve(dir, { child: false });
        if (clean && existing(clean).kind !== "dir") throw new WorkspaceFsError("notFound", dir);
        return children(clean);
      }),
    read: (path) =>
      run(() => {
        const node = existing(resolve(path));
        if (node.kind !== "file") throw new WorkspaceFsError("notFound", path);
        return node.content;
      }),
    write: (path, content) =>
      run(() => {
        const clean = resolve(path);
        if (nodes.get(clean)?.kind === "dir") throw new WorkspaceFsError("alreadyExists", path);
        nodes.set(clean, { kind: "file", content });
        changed(clean);
      }),
    createFile: (path) =>
      run(() => {
        const clean = resolve(path);
        if (nodes.has(clean)) throw new WorkspaceFsError("alreadyExists", path);
        nodes.set(clean, { kind: "file", content: "" });
        changed(clean);
      }),
    createDir: (path) =>
      run(() => {
        const clean = resolve(path);
        if (nodes.has(clean)) throw new WorkspaceFsError("alreadyExists", path);
        nodes.set(clean, { kind: "dir" });
        changed(clean);
      }),
    rename: (from, to) =>
      run(() => {
        const source = resolve(from);
        const target = resolve(to);
        existing(source);
        if (nodes.has(target)) throw new WorkspaceFsError("alreadyExists", to);
        if (target.startsWith(`${source}/`)) throw new WorkspaceFsError("io", `cannot move ${from} into itself`);
        for (const [path, node] of [...nodes.entries()]) {
          if (path === source || path.startsWith(`${source}/`)) {
            nodes.delete(path);
            nodes.set(target + path.slice(source.length), node);
          }
        }
        changed(source, target);
      }),
    delete: (path) =>
      run(() => {
        const clean = resolve(path);
        existing(clean);
        for (const key of [...nodes.keys()]) if (key === clean || key.startsWith(`${clean}/`)) nodes.delete(key);
        changed(clean);
      }),
    onChange: async (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
}
