// Hosts one Monaco editor for all tabs: each open file is a Monaco model (its own undo history and
// language), swapped in when its tab becomes active. Monaco itself is loaded on first use.
import type { editor, IDisposable } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OpenDocument } from "./documents";
import { buildMonacoTheme, readCssTokens, themeName } from "./monaco-theme";

type Monaco = typeof import("monaco-editor");

interface ModelEntry {
  model: editor.ITextModel;
  diskVersion: number;
  subscription: IDisposable;
}

export interface CodeEditorProps {
  docs: readonly OpenDocument[];
  active: string | null;
  onEdit: (path: string, text: string) => void;
  onSave: () => void;
  fontSize: number;
  tabSize: number;
  theme: string;
  mode: "light" | "dark";
}

export function CodeEditor({ docs, active, onEdit, onSave, fontSize, tabSize, theme, mode }: CodeEditorProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, ModelEntry>());
  const viewStates = useRef(new Map<string, editor.ICodeEditorViewState | null>());
  const shownPath = useRef<string | null>(null);
  // Latest callbacks, so Monaco's listeners (registered once) never call stale ones.
  const callbacks = useRef({ onEdit, onSave });
  callbacks.current = { onEdit, onSave };

  useEffect(() => {
    let alive = true;
    void import("./monaco").then((module) => alive && setMonaco(module.monaco));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!monaco || !host.current) return;
    const instance = monaco.editor.create(host.current, {
      model: null,
      automaticLayout: true,
      fontFamily: readCssTokens()("font-code"),
      fontLigatures: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: "all",
      smoothScrolling: true,
      padding: { top: 8 },
    });
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacks.current.onSave());
    editorRef.current = instance;
    const entries = models.current;
    return () => {
      instance.dispose();
      for (const entry of entries.values()) {
        entry.subscription.dispose();
        entry.model.dispose();
      }
      entries.clear();
      editorRef.current = null;
      shownPath.current = null;
    };
  }, [monaco]);

  // Keep one model per ready document, in step with the disk, and show the active one.
  useEffect(() => {
    const instance = editorRef.current;
    if (!monaco || !instance) return;
    const entries = models.current;
    const ready = docs.filter((d) => d.status === "ready");

    for (const doc of ready) {
      const entry = entries.get(doc.path);
      if (!entry) {
        const model = monaco.editor.createModel(doc.text, undefined, monaco.Uri.file(`/${doc.path}`));
        model.updateOptions({ tabSize });
        const subscription = model.onDidChangeContent(() => callbacks.current.onEdit(doc.path, model.getValue()));
        entries.set(doc.path, { model, diskVersion: doc.diskVersion, subscription });
      } else if (entry.diskVersion !== doc.diskVersion) {
        // Replaced from disk: an edit operation, so undo can still go back to the learner's text.
        entry.diskVersion = doc.diskVersion;
        if (entry.model.getValue() !== doc.text) {
          entry.model.pushEditOperations([], [{ range: entry.model.getFullModelRange(), text: doc.text }], () => null);
        }
      }
    }

    const target = active ? (entries.get(active) ?? null) : null;
    if (shownPath.current !== (target ? active : null)) {
      if (shownPath.current) viewStates.current.set(shownPath.current, instance.saveViewState());
      instance.setModel(target?.model ?? null);
      shownPath.current = target ? active : null;
      if (target && active) {
        const state = viewStates.current.get(active);
        if (state) instance.restoreViewState(state);
        instance.focus();
      }
    }

    // Closed or renamed tabs: their models go (a rename gets a fresh model under the new path).
    for (const [path, entry] of entries) {
      if (ready.some((d) => d.path === path)) continue;
      entry.subscription.dispose();
      entry.model.dispose();
      entries.delete(path);
      viewStates.current.delete(path);
    }
  }, [monaco, docs, active, tabSize]);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize });
    for (const entry of models.current.values()) entry.model.updateOptions({ tabSize });
  }, [monaco, fontSize, tabSize]);

  // Colors come from the tokens on <html>, read once the theme attributes are applied.
  useEffect(() => {
    if (!monaco) return;
    const frame = requestAnimationFrame(() => {
      const name = themeName(theme, mode);
      monaco.editor.defineTheme(name, buildMonacoTheme(readCssTokens(), mode));
      monaco.editor.setTheme(name);
    });
    return () => cancelAnimationFrame(frame);
  }, [monaco, theme, mode]);

  return (
    <div className="relative h-full min-h-0 bg-surface-editor">
      <div ref={host} className="absolute inset-0" data-testid="monaco-host" />
      {!monaco && <p className="absolute inset-0 p-3 text-xs text-text-muted">{t("editor.loading")}</p>}
    </div>
  );
}
