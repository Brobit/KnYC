// Shared by the Tauri backend and the in-memory one (fake-workspace-fs.ts).

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

export interface WorkspaceFs {
  /** Shows the open-folder dialog; null when cancelled. */
  pick(): Promise<WorkspaceInfo | null>;
  /** Reopens a folder picked before (recent projects). */
  open(root: string): Promise<WorkspaceInfo>;
  /** Creates the learner's workspace for a path (#62): a new or empty folder, or a KnYC workspace already. */
  create(root: string): Promise<WorkspaceInfo>;
  close(): Promise<void>;
  tree(): Promise<TreeEntry[]>;
  /** Direct children of a folder ("" for the root). */
  list(dir: string): Promise<TreeEntry[]>;
  read(path: string): Promise<string>;
  /** Also for paths the tree hides (node_modules). */
  exists(path: string): Promise<boolean>;
  write(path: string, content: string): Promise<void>;
  createFile(path: string): Promise<void>;
  createDir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  /** Called with the relative paths created, modified or removed on disk (batched every ~200 ms). */
  onChange(handler: (paths: string[]) => void): Promise<() => void>;
}
