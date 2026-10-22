// The files open in the editor, independent of Monaco: their text as saved on disk and as being
// edited, which tab is active, and what happens when the file changes on disk.
import { isInside, movedPath } from "@/explorer/tree";
import { WorkspaceFsError, type WorkspaceFs } from "@/lib/workspace-fs";

export interface OpenDocument {
  path: string;
  status: "loading" | "ready" | "error";
  /** Error message key suffix (explorer.errors.*) when the file cannot be shown. */
  error?: WorkspaceFsError["kind"];
  /** Text on disk as of the last load or save. */
  savedText: string;
  /** Text in the editor. */
  text: string;
  /** Bumped whenever `text` is replaced from disk, so the editor knows to reload its model. */
  diskVersion: number;
  /** The file changed on disk while it had unsaved edits: the learner chooses which to keep. */
  conflict: "changed" | "deleted" | null;
  /** Deleted on disk but kept open with its edits; saving writes it again. */
  missing?: boolean;
}

export interface DocumentsSnapshot {
  tabs: readonly OpenDocument[];
  active: string | null;
}

export const isDirty = (doc: OpenDocument) => doc.status === "ready" && (doc.text !== doc.savedText || doc.missing === true);

export class DocumentStore {
  private snapshot: DocumentsSnapshot = { tabs: [], active: null };
  private listeners = new Set<() => void>();

  private readonly fs: WorkspaceFs;

  constructor(fs: WorkspaceFs) {
    this.fs = fs;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  get(path: string) {
    return this.snapshot.tabs.find((d) => d.path === path);
  }

  /** Opens a file in a tab (or switches to its tab) and loads it. */
  async open(path: string): Promise<void> {
    if (this.get(path)) return this.activate(path);
    const doc: OpenDocument = { path, status: "loading", savedText: "", text: "", diskVersion: 0, conflict: null };
    this.set({ tabs: [...this.snapshot.tabs, doc], active: path });
    await this.load(path);
  }

  activate(path: string): void {
    if (this.get(path)) this.set({ ...this.snapshot, active: path });
  }

  edit(path: string, text: string): void {
    const doc = this.get(path);
    if (doc && doc.text !== text) this.update(path, { text });
  }

  async save(path: string): Promise<void> {
    const doc = this.get(path);
    if (!doc || doc.status !== "ready") return;
    const text = doc.text;
    await this.fs.write(path, text);
    this.update(path, { savedText: text, conflict: null, missing: false });
  }

  /** Closes a tab without asking; the UI asks first when it is dirty. */
  close(path: string): void {
    const index = this.snapshot.tabs.findIndex((d) => d.path === path);
    if (index < 0) return;
    const tabs = this.snapshot.tabs.filter((d) => d.path !== path);
    // Like other editors: the tab to the right takes over, else the one to the left.
    const active = this.snapshot.active === path ? (tabs[index] ?? tabs[index - 1])?.path ?? null : this.snapshot.active;
    this.set({ tabs, active });
  }

  /** Files changed on disk (watcher). Clean tabs follow the disk; dirty ones get a conflict to resolve. */
  async diskChanged(paths: string[]): Promise<void> {
    const touched = this.snapshot.tabs.filter((d) => d.status !== "loading" && paths.some((p) => isInside(d.path, p)));
    await Promise.all(
      touched.map(async (doc) => {
        try {
          const disk = await this.fs.read(doc.path);
          const current = this.get(doc.path);
          if (!current || disk === current.savedText) return;
          if (isDirty(current)) this.update(doc.path, { conflict: "changed" });
          else this.replaceFromDisk(doc.path, disk);
        } catch (error) {
          if (!(error instanceof WorkspaceFsError && error.kind === "notFound")) return;
          const current = this.get(doc.path);
          if (!current) return;
          if (isDirty(current)) this.update(doc.path, { conflict: "deleted" });
          else this.close(doc.path);
        }
      }),
    );
  }

  /** Conflict resolution: take the disk version and drop the unsaved edits. */
  async reloadFromDisk(path: string): Promise<void> {
    try {
      this.replaceFromDisk(path, await this.fs.read(path));
    } catch {
      this.close(path);
    }
  }

  /** Conflict resolution: keep the edits; the next save overwrites the disk (or recreates the file). */
  async keepMine(path: string): Promise<void> {
    const doc = this.get(path);
    if (!doc) return;
    if (doc.conflict === "deleted") return this.update(path, { conflict: null, missing: true });
    try {
      this.update(path, { conflict: null, savedText: await this.fs.read(path) });
    } catch {
      this.update(path, { conflict: null, missing: true });
    }
  }

  /** The Explorer renamed `from` (a file or a folder) to `to`. */
  moved(from: string, to: string): void {
    const tabs = this.snapshot.tabs.map((d) => (isInside(d.path, from) ? { ...d, path: movedPath(d.path, from, to) } : d));
    const active = this.snapshot.active && movedPath(this.snapshot.active, from, to);
    this.set({ tabs, active });
  }

  /** The Explorer deleted `path` (after confirmation): its tabs close. */
  deleted(path: string): void {
    for (const doc of this.snapshot.tabs) if (isInside(doc.path, path)) this.close(doc.path);
  }

  reset(): void {
    this.set({ tabs: [], active: null });
  }

  private async load(path: string) {
    try {
      const text = await this.fs.read(path);
      this.update(path, { status: "ready", savedText: text, text, diskVersion: (this.get(path)?.diskVersion ?? 0) + 1 });
    } catch (error) {
      this.update(path, { status: "error", error: error instanceof WorkspaceFsError ? error.kind : "io" });
    }
  }

  private replaceFromDisk(path: string, text: string) {
    const doc = this.get(path);
    if (doc) this.update(path, { savedText: text, text, conflict: null, diskVersion: doc.diskVersion + 1 });
  }

  private update(path: string, change: Partial<OpenDocument>) {
    if (!this.get(path)) return;
    this.set({ ...this.snapshot, tabs: this.snapshot.tabs.map((d) => (d.path === path ? { ...d, ...change } : d)) });
  }

  private set(snapshot: DocumentsSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
