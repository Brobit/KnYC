// The Explorer panel (design 04 §7, issue #32): the workspace folder as a lazily loaded tree.
// Folders load when expanded; changes on disk (terminal, git, the editor) reload what is shown.
import { ChevronRight, ChevronsDownUp, FilePlus, FolderOpen, FolderPlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRegisterCommands } from "@/commands/commands";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { WorkspaceFsError } from "@/lib/workspace-fs";
import { cn } from "@/lib/utils";
import { useShowPanel } from "@/workspace/panel-context";
import { useWorkspace } from "@/workspace/workspace-context";
import { fileIcon } from "./file-icons";
import {
  foldersToReload,
  isInside,
  joinPath,
  movedPath,
  nameProblem,
  parentOf,
  pruneChildren,
  sortEntries,
  visibleRows,
  type TreeNode,
  type TreeRowData,
} from "./tree";

/** A name being typed: a new file or folder inside `dir`, or a new name for `path`. */
type Draft = { mode: "file" | "dir"; dir: string } | { mode: "rename"; path: string };

const INDENT = 14;

/** A closing menu gives focus back to its row by default, which would steal it from the name field it just opened. */
const keepFocus = (event: Event) => event.preventDefault();

export function Explorer() {
  const { t } = useTranslation();
  const { fs, folder, pickFolder, activeFile, openFile, onMoved, onDeleted } = useWorkspace();
  const [children, setChildren] = useState<Map<string, TreeNode[]>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const showPanel = useShowPanel("explorer");
  const childrenRef = useRef(children);
  childrenRef.current = children;

  const report = useCallback(
    (e: unknown, path = "") => {
      const kind = e instanceof WorkspaceFsError ? e.kind : "io";
      setError(t(`explorer.errors.${kind}`, { path, detail: e instanceof Error ? e.message : String(e) }));
    },
    [t],
  );

  /** (Re)loads folders; one that disappeared is dropped with everything loaded under it. */
  const load = useCallback(
    async (dirs: string[]) => {
      if (dirs.length === 0) return;
      const results = await Promise.allSettled(dirs.map((dir) => fs.list(dir)));
      setChildren((previous) => {
        const next = new Map(previous);
        dirs.forEach((dir, i) => {
          const result = results[i];
          if (result.status === "fulfilled") pruneChildren(next, dir, sortEntries(result.value));
          else for (const path of [...next.keys()]) if (dir && isInside(path, dir)) next.delete(path);
        });
        return next;
      });
      const failed = results.findIndex((r) => r.status === "rejected" && !(r.reason instanceof WorkspaceFsError && r.reason.kind === "notFound"));
      if (failed >= 0) report((results[failed] as PromiseRejectedResult).reason, dirs[failed]);
    },
    [fs, report],
  );

  // A new folder starts collapsed at its root.
  useEffect(() => {
    setChildren(new Map());
    setExpanded(new Set());
    setSelected(null);
    setDraft(null);
    setError(null);
    if (folder) void load([""]);
  }, [folder, load]);

  useEffect(() => {
    if (!folder) return;
    const unlisten = fs.onChange((paths) => void load(foldersToReload(paths, childrenRef.current)));
    return () => void unlisten.then((stop) => stop());
  }, [folder, fs, load]);

  const rows = useMemo(() => visibleRows(children, expanded), [children, expanded]);

  const expand = (path: string) => {
    setExpanded((s) => new Set(s).add(path));
    if (!childrenRef.current.has(path)) void load([path]);
  };
  const collapse = (path: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.delete(path);
      return next;
    });

  const activate = (row: TreeNode & { expanded?: boolean }) => {
    setSelected(row.path);
    if (row.kind === "dir") (row.expanded ? collapse : expand)(row.path);
    else openFile(row.path);
  };

  /** Where "New file" goes: the selected folder, the selected file's folder, or the root. */
  const targetDir = (node?: TreeNode | null) => {
    if (!node) return "";
    return node.kind === "dir" ? node.path : parentOf(node.path);
  };
  const startCreate = (mode: "file" | "dir", node?: TreeNode | null) => {
    const dir = targetDir(node);
    if (dir) expand(dir);
    setDraft({ mode, dir });
    setError(null);
  };

  const submitDraft = async (name: string) => {
    if (!draft) return;
    const current = draft;
    setDraft(null);
    try {
      if (current.mode === "rename") {
        const to = joinPath(parentOf(current.path), name);
        if (to === current.path) return;
        await fs.rename(current.path, to);
        setExpanded((s) => new Set([...s].map((p) => movedPath(p, current.path, to))));
        setSelected(to);
        onMoved(current.path, to);
        await load([parentOf(current.path)]);
      } else {
        const path = joinPath(current.dir, name);
        await (current.mode === "file" ? fs.createFile(path) : fs.createDir(path));
        await load([current.dir]);
        setSelected(path);
        if (current.mode === "file") openFile(path);
      }
    } catch (e) {
      report(e, current.mode === "rename" ? current.path : joinPath(current.dir, name));
    }
    treeRef.current?.focus();
  };

  const confirmDelete = async () => {
    const node = toDelete;
    setToDelete(null);
    if (!node) return;
    try {
      await fs.delete(node.path);
      onDeleted(node.path);
      setSelected(null);
      await load([parentOf(node.path)]);
    } catch (e) {
      report(e, node.path);
    }
    treeRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (draft || rows.length === 0) return;
    const index = rows.findIndex((r) => r.path === selected);
    const row = rows[index];
    const select = (i: number) => setSelected(rows[Math.max(0, Math.min(rows.length - 1, i))].path);
    const handled = () => event.preventDefault();
    switch (event.key) {
      case "ArrowDown":
        handled();
        return select(index + 1);
      case "ArrowUp":
        handled();
        return select(index < 0 ? 0 : index - 1);
      case "ArrowRight":
        handled();
        if (row?.kind === "dir") return row.expanded ? select(index + 1) : expand(row.path);
        return;
      case "ArrowLeft":
        handled();
        if (row?.kind === "dir" && row.expanded) return collapse(row.path);
        if (row && parentOf(row.path)) return setSelected(parentOf(row.path));
        return;
      case "Enter":
        handled();
        if (row) activate(row);
        return;
      case "F2":
        handled();
        if (row) setDraft({ mode: "rename", path: row.path });
        return;
      case "Delete":
        handled();
        if (row) setToDelete(row);
        return;
    }
  };

  const selectedRow = rows.find((r) => r.path === selected) ?? null;
  // In the Explorer itself, F2 and Delete do the same for the selected row.
  useRegisterCommands(
    () => {
      if (!folder) return [];
      const command = (id: string, title: string, run: () => void) => ({
        id: `explorer.${id}`,
        title,
        group: "file" as const,
        scope: "workspace" as const,
        run: () => {
          showPanel();
          run();
        },
      });
      return [
        command("newFile", t("explorer.newFile"), () => startCreate("file", selectedRow)),
        command("newFolder", t("explorer.newFolder"), () => startCreate("dir", selectedRow)),
        command("refresh", t("commands.refreshExplorer"), () => void load([...childrenRef.current.keys()])),
        command("collapseAll", t("commands.collapseExplorer"), () => setExpanded(new Set())),
        ...(selectedRow
          ? [
              command("rename", t("commands.renameNamed", { name: selectedRow.name }), () => setDraft({ mode: "rename", path: selectedRow.path })),
              command("delete", t("commands.deleteNamed", { name: selectedRow.name }), () => setToDelete(selectedRow)),
            ]
          : []),
      ];
    },
    [t, folder, selectedRow?.path],
  );

  if (!folder) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
        <FolderOpen className="size-5 text-text-muted" aria-hidden />
        <p className="max-w-[220px] text-xs text-text-muted">{t("explorer.noFolder")}</p>
        <Button size="sm" variant="outline" onClick={() => void pickFolder().catch((e) => report(e))}>
          {t("explorer.openFolder")}
        </Button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }

  const rootLoaded = children.has("");
  const createRow = (dir: string, depth: number) =>
    draft && draft.mode !== "rename" && draft.dir === dir ? (
      <NameInput
        key="draft"
        depth={depth}
        icon={fileIcon({ kind: draft.mode }, "")}
        siblings={children.get(dir) ?? []}
        label={t(draft.mode === "file" ? "explorer.newFile" : "explorer.newFolder")}
        onSubmit={submitDraft}
        onCancel={() => setDraft(null)}
      />
    ) : null;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[0.06em] text-text-secondary uppercase" title={folder.root}>
          {folder.name}
        </span>
        <ToolbarButton label={t("explorer.newFile")} onClick={() => startCreate("file", selectedRow)} icon={<FilePlus />} />
        <ToolbarButton label={t("explorer.newFolder")} onClick={() => startCreate("dir", selectedRow)} icon={<FolderPlus />} />
        <ToolbarButton label={t("explorer.refresh")} onClick={() => void load([...children.keys()])} icon={<RefreshCw />} />
        <ToolbarButton label={t("explorer.collapseAll")} onClick={() => setExpanded(new Set())} icon={<ChevronsDownUp />} />
      </div>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={treeRef}
            role="tree"
            aria-label={folder.name}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="min-h-0 flex-1 overflow-auto py-1 outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {createRow("", 0)}
            {rows.map((row) => (
              <RowWithMenu
                key={row.path}
                row={row}
                selected={row.path === selected}
                active={row.path === activeFile}
                renaming={draft?.mode === "rename" && draft.path === row.path}
                siblings={children.get(parentOf(row.path)) ?? []}
                onActivate={() => activate(row)}
                onRename={() => setDraft({ mode: "rename", path: row.path })}
                onDelete={() => setToDelete(row)}
                onCreate={(mode) => startCreate(mode, row)}
                onSubmitRename={submitDraft}
                onCancelRename={() => setDraft(null)}
                after={row.kind === "dir" && row.expanded ? createRow(row.path, row.depth + 1) : null}
              />
            ))}
            {rootLoaded && rows.length === 0 && !draft && <p className="px-3 py-2 text-xs text-text-muted">{t("explorer.empty")}</p>}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44" onCloseAutoFocus={keepFocus}>
          <ContextMenuItem onSelect={() => startCreate("file", null)}>
            <FilePlus /> {t("explorer.newFile")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => startCreate("dir", null)}>
            <FolderPlus /> {t("explorer.newFolder")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {error && (
        <button type="button" onClick={() => setError(null)} className="shrink-0 border-t border-border bg-danger-soft px-3 py-1.5 text-left text-xs text-danger">
          {error}
        </button>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("explorer.deleteTitle", { name: toDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(toDelete?.kind === "dir" ? "explorer.deleteFolderBody" : "explorer.deleteFileBody", { path: toDelete?.path })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("explorer.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              {t("explorer.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ToolbarButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={onClick}>
      {icon}
    </Button>
  );
}

interface RowProps {
  row: TreeRowData;
  selected: boolean;
  active: boolean;
  renaming: boolean;
  siblings: TreeNode[];
  onActivate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCreate: (mode: "file" | "dir") => void;
  onSubmitRename: (name: string) => void;
  onCancelRename: () => void;
  after: ReactNode;
}

function RowWithMenu({ row, selected, active, renaming, siblings, onActivate, onRename, onDelete, onCreate, onSubmitRename, onCancelRename, after }: RowProps) {
  const { t } = useTranslation();
  const Icon = fileIcon(row, row.name, row.expanded);
  if (renaming) {
    return (
      <>
        <NameInput depth={row.depth} icon={Icon} initial={row.name} siblings={siblings} label={t("explorer.rename")} onSubmit={onSubmitRename} onCancel={onCancelRename} />
        {after}
      </>
    );
  }
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-selected={selected}
            aria-expanded={row.kind === "dir" ? row.expanded : undefined}
            aria-level={row.depth + 1}
            title={row.path}
            onClick={onActivate}
            style={{ paddingLeft: 6 + row.depth * INDENT }}
            className={cn(
              "flex h-6 cursor-pointer items-center gap-1 pr-2 select-none",
              active ? "bg-accent-soft" : selected ? "bg-surface-2" : "hover:bg-surface-2",
            )}
          >
            <ChevronRight
              className={cn("size-3.5 shrink-0 text-text-muted transition-transform", row.kind !== "dir" && "invisible", row.expanded && "rotate-90")}
              aria-hidden
            />
            <Icon className={cn("size-3.5 shrink-0", row.kind === "dir" ? "text-text-secondary" : "text-text-muted")} aria-hidden />
            <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", active ? "text-accent" : "text-text-primary")}>{row.name}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44" onCloseAutoFocus={keepFocus}>
          {row.kind === "dir" && (
            <>
              <ContextMenuItem onSelect={() => onCreate("file")}>
                <FilePlus /> {t("explorer.newFile")}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onCreate("dir")}>
                <FolderPlus /> {t("explorer.newFolder")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={onRename}>
            <Pencil /> {t("explorer.rename")}
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> {t("explorer.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {after}
    </>
  );
}

interface NameInputProps {
  depth: number;
  icon: ReturnType<typeof fileIcon>;
  initial?: string;
  siblings: TreeNode[];
  label: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** Inline name field: Enter or leaving the field saves, Escape cancels. */
function NameInput({ depth, icon: Icon, initial = "", siblings, label, onSubmit, onCancel }: NameInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const problem = nameProblem(value, siblings, initial || undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // After the menu that opened this field has released focus (its focus trap closes on the next tick).
    const timer = setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      // Select the name without its extension, like other editors.
      const dot = initial.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : initial.length);
    });
    return () => clearTimeout(timer);
  }, [initial]);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && !problem) onSubmit(value.trim());
    else onCancel();
  };

  return (
    <div style={{ paddingLeft: 6 + depth * INDENT }} className="flex flex-col py-0.5 pr-2">
      <div className="flex items-center gap-1">
        <span className="size-3.5 shrink-0" aria-hidden />
        <Icon className="size-3.5 shrink-0 text-text-muted" aria-hidden />
        <input
          ref={inputRef}
          aria-label={label}
          aria-invalid={problem !== null && value !== ""}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") finish(false);
          }}
          onBlur={() => finish(true)}
          className="h-5 min-w-0 flex-1 rounded-[3px] border border-ring bg-bg px-1 font-mono text-xs text-text-primary outline-none aria-invalid:border-danger"
        />
      </div>
      {problem && value !== "" && <p className="pt-0.5 pl-9 text-[11px] text-danger">{t(`explorer.nameProblems.${problem}`)}</p>}
    </div>
  );
}
