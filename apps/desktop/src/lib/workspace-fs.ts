// Typed access to the workspace folder (src-tauri/src/workspace). Paths are relative to the
// opened folder with "/" separators; Rust refuses anything outside it.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createFakeWorkspaceFs } from "./fake-workspace-fs";
import { isTauri } from "./settings";
import { WorkspaceFsError, type FsErrorKind, type WorkspaceFs } from "./workspace-fs-types";

export * from "./workspace-fs-types";

const isFsError = (value: unknown): value is { kind: FsErrorKind; message: string } =>
  typeof value === "object" && value !== null && "kind" in value && "message" in value;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (isFsError(error)) throw new WorkspaceFsError(error.kind, error.message);
    throw new WorkspaceFsError("io", String(error));
  }
}

export function createTauriWorkspaceFs(): WorkspaceFs {
  return {
    pick: () => call("workspace_pick"),
    open: (root) => call("workspace_open", { root }),
    close: () => call("workspace_close"),
    tree: () => call("workspace_tree"),
    list: (dir) => call("workspace_list", { path: dir }),
    read: (path) => call("workspace_read", { path }),
    write: (path, content) => call("workspace_write", { path, content }),
    createFile: (path) => call("workspace_create_file", { path }),
    createDir: (path) => call("workspace_create_dir", { path }),
    rename: (from, to) => call("workspace_rename", { from, to }),
    delete: (path) => call("workspace_delete", { path }),
    onChange: (handler) => listen<{ paths: string[] }>("workspace://changed", (event) => handler(event.payload.paths)),
  };
}

/** The desktop app talks to Rust; `pnpm dev` in a plain browser gets a sample project in memory. */
export const workspaceFs: WorkspaceFs = isTauri() || !import.meta.env.DEV ? createTauriWorkspaceFs() : createFakeWorkspaceFs();

// In the browser dev server, `window.knycFs` changes the sample project "from outside" (like a terminal would).
if (import.meta.env.DEV && !isTauri()) Object.assign(window, { knycFs: workspaceFs });
