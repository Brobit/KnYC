// The folder being worked on and the files open in the editor, shared by every workspace panel.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { DocumentStore } from "@/editor/documents";
import { workspaceFs as defaultFs, type WorkspaceFs, type WorkspaceInfo } from "@/lib/workspace-fs";

interface WorkspaceContext {
  fs: WorkspaceFs;
  folder: WorkspaceInfo | null;
  /** Shows the open-folder dialog; keeps the current folder when cancelled. */
  pickFolder: () => Promise<void>;
  documents: DocumentStore;
  /** The file in the editor's active tab. */
  activeFile: string | null;
  openFile: (path: string) => void;
  /** Keeps the editor in step with renames and deletions made from the Explorer. */
  onMoved: (from: string, to: string) => void;
  onDeleted: (path: string) => void;
}

const Context = createContext<WorkspaceContext | null>(null);

export function WorkspaceProvider({ children, fs = defaultFs }: { children: ReactNode; fs?: WorkspaceFs }) {
  const [folder, setFolder] = useState<WorkspaceInfo | null>(null);
  const [documents] = useState(() => new DocumentStore(fs));
  const activeFile = useSyncExternalStore(documents.subscribe, () => documents.getSnapshot().active);

  const pickFolder = useCallback(async () => {
    const picked = await fs.pick();
    if (!picked) return;
    documents.reset();
    setFolder(picked);
  }, [fs, documents]);

  // Open files follow the disk (terminal, git, another editor).
  useEffect(() => {
    if (!folder) return;
    const unlisten = fs.onChange((paths) => void documents.diskChanged(paths));
    return () => void unlisten.then((stop) => stop());
  }, [folder, fs, documents]);

  const value = useMemo<WorkspaceContext>(
    () => ({
      fs,
      folder,
      pickFolder,
      documents,
      activeFile,
      openFile: (path) => void documents.open(path),
      onMoved: (from, to) => documents.moved(from, to),
      onDeleted: (path) => documents.deleted(path),
    }),
    [fs, folder, pickFolder, documents, activeFile],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspace(): WorkspaceContext {
  const context = useContext(Context);
  if (!context) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return context;
}
