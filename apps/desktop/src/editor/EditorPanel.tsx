// The Editor panel (issue #33): tabs over one Monaco editor, Ctrl/⌘+S to save, confirmation before
// closing unsaved work, and a choice when a file with unsaved edits changes on disk.
import { X } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterCommands } from "@/commands/commands";
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
import { Button } from "@/components/ui/button";
import { fileIcon } from "@/explorer/file-icons";
import { nameOf } from "@/explorer/tree";
import { useSettings } from "@/lib/settings";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { WorkspaceFsError } from "@/lib/workspace-fs";
import { useWorkspace } from "@/workspace/workspace-context";
import { CodeEditor } from "./CodeEditor";
import { isDirty, type OpenDocument } from "./documents";

export function EditorPanel({ empty }: { empty: ReactNode }) {
  const { t } = useTranslation();
  const { documents } = useWorkspace();
  const { tabs, active } = useSyncExternalStore(documents.subscribe, documents.getSnapshot);
  const { settings } = useSettings();
  const { name: theme, resolvedMode } = useTheme();
  const [closing, setClosing] = useState<OpenDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = tabs.find((d) => d.path === active) ?? null;

  const save = async (path: string | null) => {
    if (!path) return;
    try {
      await documents.save(path);
      setError(null);
    } catch (e) {
      const kind = e instanceof WorkspaceFsError ? e.kind : "io";
      setError(t(`explorer.errors.${kind}`, { path, detail: e instanceof Error ? e.message : String(e) }));
    }
  };

  const requestClose = (doc: OpenDocument) => (isDirty(doc) ? setClosing(doc) : documents.close(doc.path));

  // Ctrl/⌘+S and Ctrl/⌘+W work anywhere in the app, Monaco included (the shortcut handler runs first).
  useRegisterCommands(
    () =>
      current
        ? [
            { id: "editor.save", title: t("commands.save"), group: "editor", shortcuts: ["Mod+S"], scope: "workspace", run: () => void save(current.path) },
            { id: "editor.close", title: t("commands.closeTab"), group: "editor", shortcuts: ["Mod+W"], scope: "workspace", run: () => requestClose(current) },
          ]
        : [],
    [t, current?.path],
  );

  if (tabs.length === 0) return <>{empty}</>;

  return (
    <div className="flex h-full flex-col bg-surface-editor">
      <div role="tablist" aria-label={t("editor.openFiles")} className="flex h-8 shrink-0 overflow-x-auto border-b border-border bg-surface-2">
        {tabs.map((doc) => (
          <Tab key={doc.path} doc={doc} active={doc.path === active} onSelect={() => documents.activate(doc.path)} onClose={() => requestClose(doc)} />
        ))}
      </div>

      {current?.conflict && (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border bg-warning-soft px-3 py-1.5 text-xs text-text-primary">
          <span className="flex-1">{t(current.conflict === "changed" ? "editor.conflictChanged" : "editor.conflictDeleted")}</span>
          <Button size="xs" variant="outline" onClick={() => void documents.reloadFromDisk(current.path)}>
            {t(current.conflict === "changed" ? "editor.reload" : "editor.closeTab")}
          </Button>
          <Button size="xs" onClick={() => void documents.keepMine(current.path)}>
            {t("editor.keepMine")}
          </Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <CodeEditor
          docs={tabs}
          active={active}
          onEdit={(path, text) => documents.edit(path, text)}
          onSave={() => void save(documents.getSnapshot().active)}
          fontSize={settings.editor.fontSize}
          tabSize={settings.editor.tabSize}
          theme={theme}
          mode={resolvedMode}
        />
        {current && current.status !== "ready" && (
          <div className="absolute inset-0 bg-surface-editor p-3 text-xs">
            {current.status === "loading" ? (
              <span className="text-text-muted">{t("editor.loading")}</span>
            ) : (
              <span className="text-danger">{t(`explorer.errors.${current.error ?? "io"}`, { path: current.path, detail: "" })}</span>
            )}
          </div>
        )}
      </div>

      {error && (
        <button type="button" onClick={() => setError(null)} className="shrink-0 border-t border-border bg-danger-soft px-3 py-1.5 text-left text-xs text-danger">
          {error}
        </button>
      )}

      <AlertDialog open={closing !== null} onOpenChange={(open) => !open && setClosing(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("editor.unsavedTitle", { name: closing && nameOf(closing.path) })}</AlertDialogTitle>
            <AlertDialogDescription>{t("editor.unsavedBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("explorer.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={() => closing && documents.close(closing.path)}>
              {t("editor.dontSave")}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                const doc = closing;
                if (doc) void save(doc.path).then(() => !isDirty(documents.get(doc.path) ?? doc) && documents.close(doc.path));
              }}
            >
              {t("editor.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Tab({ doc, active, onSelect, onClose }: { doc: OpenDocument; active: boolean; onSelect: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const name = nameOf(doc.path);
  const Icon = fileIcon({ kind: "file" }, name);
  const dirty = isDirty(doc);
  return (
    <div
      role="tab"
      aria-selected={active}
      title={doc.path}
      onClick={onSelect}
      onAuxClick={(e) => e.button === 1 && onClose()}
      className={cn(
        "group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border pr-1 pl-3 text-xs select-none",
        active ? "bg-surface-editor text-text-primary shadow-[inset_0_-2px_0_var(--accent)]" : "text-text-secondary hover:text-text-primary",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-text-muted" aria-hidden />
      <span className={cn("max-w-[180px] truncate", doc.conflict && "text-warning")}>{name}</span>
      <button
        type="button"
        aria-label={t("editor.closeNamed", { name })}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="flex size-5 items-center justify-center rounded-[4px] text-text-muted hover:bg-surface-2 hover:text-text-primary"
      >
        {/* Unsaved: a dot that turns into the close cross on hover. */}
        {dirty ? (
          <>
            <span className="size-2 rounded-full bg-text-secondary group-hover:hidden" aria-label={t("editor.unsaved")} />
            <X className="hidden size-3.5 group-hover:block" aria-hidden />
          </>
        ) : (
          <X className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}
