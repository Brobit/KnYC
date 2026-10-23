// Reveal original (design/04 §7a, #63): the original's change for the step, file by file, in a
// Monaco diff (R_k-1 → R_k), or the learner's code against the original. Revealing is the last
// rung of the help ladder and is counted; "Apply to my workspace" comes with snapshots (#65).
import type { editor } from "monaco-editor";
import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildMonacoTheme, readCssTokens, themeName } from "@/editor/monaco-theme";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { Reveal } from "./learning-context";

type Monaco = typeof import("monaco-editor");

/** A read-only side-by-side diff of two texts; the language comes from the file name. */
function DiffView({ path, original, modified }: { path: string; original: string; modified: string }) {
  const { t } = useTranslation();
  const { name, resolvedMode } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const diff = useRef<editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    let alive = true;
    void import("@/editor/monaco").then((module) => alive && setMonaco(module.monaco)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!monaco || !host.current) return;
    const instance = monaco.editor.createDiffEditor(host.current, { readOnly: true, automaticLayout: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false });
    diff.current = instance;
    return () => {
      instance.getModel()?.original.dispose();
      instance.getModel()?.modified.dispose();
      instance.dispose();
      diff.current = null;
    };
  }, [monaco]);

  useEffect(() => {
    const instance = diff.current;
    if (!monaco || !instance) return;
    const previous = instance.getModel();
    // Same URI for both sides would clash: the language comes from the extension anyway.
    const model = (text: string, side: string) => monaco.editor.createModel(text, undefined, monaco.Uri.file(`/knyc-reveal/${side}/${path}`));
    instance.setModel({ original: model(original, "a"), modified: model(modified, "b") });
    previous?.original.dispose();
    previous?.modified.dispose();
  }, [monaco, path, original, modified]);

  useEffect(() => {
    if (!monaco) return;
    const frame = requestAnimationFrame(() => {
      const theme = themeName(name, resolvedMode);
      monaco.editor.defineTheme(theme, buildMonacoTheme(readCssTokens(), resolvedMode));
      monaco.editor.setTheme(theme);
    });
    return () => cancelAnimationFrame(frame);
  }, [monaco, name, resolvedMode]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-surface-editor">
      <div ref={host} className="absolute inset-0" data-testid="reveal-diff" />
      {!monaco && <p className="absolute inset-0 p-3 text-xs text-text-muted">{t("editor.loading")}</p>}
    </div>
  );
}

export function RevealDialog({ reveal, onClose }: { reveal: Reveal | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const changes = reveal?.changes ?? [];
  const change = changes.find((c) => c.path === selected) ?? changes[0];

  return (
    <Dialog open={reveal !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] w-[min(1100px,94vw)] max-w-none flex-col gap-3 sm:max-w-none">
        <DialogHeader>
          <DialogTitle>{t("reveal.title")}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 text-warning">
            <Eye className="size-3.5" aria-hidden />
            {t("reveal.counted")}
          </DialogDescription>
        </DialogHeader>
        {changes.length === 0 ? (
          <p className="text-sm text-text-muted">{t("reveal.empty")}</p>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3">
            <ul className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto" aria-label={t("reveal.files")}>
              {changes.map((c) => (
                <li key={c.path}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.path)}
                    aria-current={c === change ? "true" : undefined}
                    className={cn("w-full truncate rounded px-2 py-1 text-left font-mono text-xs", c === change ? "bg-accent-soft text-accent" : "text-text-secondary hover:bg-surface-2")}
                    title={c.path}
                  >
                    {c.path}
                  </button>
                  <span className="sr-only">{t(c.before === null ? "reveal.added" : c.after === null ? "reveal.removed" : "reveal.changed")}</span>
                </li>
              ))}
            </ul>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center gap-3 text-xs text-text-secondary">
                <span className="min-w-0 flex-1 truncate">
                  {mine ? t("reveal.sidesMine") : t("reveal.sidesOriginal")}
                </span>
                <label htmlFor="reveal-mine" className="flex items-center gap-2">
                  {t("reveal.compareMine")}
                  <Switch id="reveal-mine" checked={mine} onCheckedChange={setMine} />
                </label>
              </div>
              {change && <DiffView path={change.path} original={(mine ? reveal!.mine.get(change.path) : change.before) ?? ""} modified={change.after ?? ""} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
