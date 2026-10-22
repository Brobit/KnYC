// Typed access to the workspace folder (src-tauri/src/workspace). Paths are relative to the
// opened folder with "/" separators; Rust refuses anything outside it.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface WorkspaceInfo {
  root: string;
  name: string;
}

export interface TreeEntry {
  path: string;
  kind: "file" | "dir" | "symlink";
}

export type FsErrorKind = "noWorkspace" | "outsideWorkspace" | "notFound" | "alreadyExists" | "notText" | "tooLarge" | "io";

/** The error every workspace command rejects with. */
export class WorkspaceFsError extends Error {
  readonly kind: FsErrorKind;
  constructor(kind: FsErrorKind, message: string) {
    super(message);
    this.name = "WorkspaceFsError";
    this.kind = kind;
  }
}

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

export const workspaceFs = {
  /** Shows the open-folder dialog; null when cancelled. */
  pick: () => call<WorkspaceInfo | null>("workspace_pick"),
  /** Reopens a folder picked before (recent projects). */
  open: (root: string) => call<WorkspaceInfo>("workspace_open", { root }),
  close: () => call<void>("workspace_close"),
  tree: () => call<TreeEntry[]>("workspace_tree"),
  read: (path: string) => call<string>("workspace_read", { path }),
  write: (path: string, content: string) => call<void>("workspace_write", { path, content }),
  createFile: (path: string) => call<void>("workspace_create_file", { path }),
  createDir: (path: string) => call<void>("workspace_create_dir", { path }),
  rename: (from: string, to: string) => call<void>("workspace_rename", { from, to }),
  delete: (path: string) => call<void>("workspace_delete", { path }),
};

/** Called with the relative paths created, modified or removed on disk (batched every ~200 ms). */
export function onWorkspaceChange(handler: (paths: string[]) => void): Promise<UnlistenFn> {
  return listen<{ paths: string[] }>("workspace://changed", (event) => handler(event.payload.paths));
}
