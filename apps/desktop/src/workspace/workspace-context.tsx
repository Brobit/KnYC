// The folder being worked on and the files open in the editor, shared by every workspace panel.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { withoutRecentWorkspace, withRecentWorkspace, type RecentWorkspace, type Workspaces } from "@knyc/core/schemas";
import { DocumentStore } from "@/editor/documents";
import { recentStore as defaultRecents, type RecentStore } from "@/lib/recent-workspaces";
import { workspaceFs as defaultFs, type WorkspaceFs, type WorkspaceInfo } from "@/lib/workspace-fs";

interface WorkspaceContext {
  fs: WorkspaceFs;
  folder: WorkspaceInfo | null;
  /** Shows the open-folder dialog; keeps the current folder when cancelled. Resolves to whether a folder was opened. */
  pickFolder: () => Promise<boolean>;
  /** Creates the learner's workspace folder for a path (#62) and opens it. */
  createFolder: (root: string) => Promise<WorkspaceInfo>;
  /** Folders opened lately, most recent first. */
  recent: RecentWorkspace[];
  /** Reopens a recent folder; rejects (WorkspaceFsError) when it is gone. */
  openRecent: (root: string) => Promise<void>;
  forgetRecent: (root: string) => void;
  documents: DocumentStore;
  /** The file in the editor's active tab. */
  activeFile: string | null;
  openFile: (path: string) => void;
  /** Keeps the editor in step with renames and deletions made from the Explorer. */
  onMoved: (from: string, to: string) => void;
  onDeleted: (path: string) => void;
}

const Context = createContext<WorkspaceContext | null>(null);

interface WorkspaceProviderProps {
  children: ReactNode;
  fs?: WorkspaceFs;
  recents?: RecentStore;
}

export function WorkspaceProvider({ children, fs = defaultFs, recents = defaultRecents }: WorkspaceProviderProps) {
  const [folder, setFolder] = useState<WorkspaceInfo | null>(null);
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const [documents] = useState(() => new DocumentStore(fs));
  const activeFile = useSyncExternalStore(documents.subscribe, () => documents.getSnapshot().active);

  useEffect(() => {
    void recents.load().then((doc) => setRecent(doc.recent));
  }, [recents]);

  /** Changes to workspaces.json run one after the other, each from the saved file, so none is lost. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const changeRecent = useCallback(
    (change: (doc: Workspaces) => Workspaces) => {
      queue.current = queue.current
        .then(async () => {
          const next = change(await recents.load());
          setRecent(next.recent);
          await recents.save(next);
        })
        .catch((error) => console.error("could not save recent workspaces", error));
    },
    [recents],
  );

  const opened = useCallback(
    (info: WorkspaceInfo) => {
      documents.reset();
      setFolder(info);
      changeRecent((doc) => withRecentWorkspace(doc, { root: info.root, name: info.name, lastOpenedAt: new Date().toISOString() }));
    },
    [documents, changeRecent],
  );

  const pickFolder = useCallback(async () => {
    const picked = await fs.pick();
    if (!picked) return false;
    opened(picked);
    return true;
  }, [fs, opened]);

  const openRecent = useCallback(async (root: string) => opened(await fs.open(root)), [fs, opened]);
  const createFolder = useCallback(
    async (root: string) => {
      const info = await fs.create(root);
      opened(info);
      return info;
    },
    [fs, opened],
  );
  const forgetRecent = useCallback((root: string) => changeRecent((doc) => withoutRecentWorkspace(doc, root)), [changeRecent]);

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
      createFolder,
      recent,
      openRecent,
      forgetRecent,
      documents,
      activeFile,
      openFile: (path) => void documents.open(path),
      onMoved: (from, to) => documents.moved(from, to),
      onDeleted: (path) => documents.deleted(path),
    }),
    [fs, folder, pickFolder, createFolder, recent, openRecent, forgetRecent, documents, activeFile],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspace(): WorkspaceContext {
  const context = useContext(Context);
  if (!context) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return context;
}
