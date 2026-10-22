// The folder being worked on and the file shown in the editor, shared by every workspace panel.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { movedPath, isInside } from "@/explorer/tree";
import { workspaceFs as defaultFs, type WorkspaceFs, type WorkspaceInfo } from "@/lib/workspace-fs";

interface WorkspaceContext {
  fs: WorkspaceFs;
  folder: WorkspaceInfo | null;
  /** Shows the open-folder dialog; keeps the current folder when cancelled. */
  pickFolder: () => Promise<void>;
  activeFile: string | null;
  openFile: (path: string) => void;
  /** Keeps the editor in step with renames and deletions made from the Explorer. */
  onMoved: (from: string, to: string) => void;
  onDeleted: (path: string) => void;
}

const Context = createContext<WorkspaceContext | null>(null);

export function WorkspaceProvider({ children, fs = defaultFs }: { children: ReactNode; fs?: WorkspaceFs }) {
  const [folder, setFolder] = useState<WorkspaceInfo | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const pickFolder = useCallback(async () => {
    const picked = await fs.pick();
    if (!picked) return;
    setFolder(picked);
    setActiveFile(null);
  }, [fs]);

  const onMoved = useCallback((from: string, to: string) => setActiveFile((f) => f && movedPath(f, from, to)), []);
  const onDeleted = useCallback((path: string) => setActiveFile((f) => (f && isInside(f, path) ? null : f)), []);

  const value = useMemo(
    () => ({ fs, folder, pickFolder, activeFile, openFile: setActiveFile, onMoved, onDeleted }),
    [fs, folder, pickFolder, activeFile, onMoved, onDeleted],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspace(): WorkspaceContext {
  const context = useContext(Context);
  if (!context) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return context;
}
