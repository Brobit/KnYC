// Shows the file opened from the Explorer, read only, until Monaco replaces it (#33).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceFsError } from "@/lib/workspace-fs";
import { useWorkspace } from "./workspace-context";

type Content = { path: string; text: string } | { path: string; error: string } | null;

export function EditorPreview({ fallback }: { fallback: React.ReactNode }) {
  const { t } = useTranslation();
  const { fs, activeFile } = useWorkspace();
  const [content, setContent] = useState<Content>(null);

  useEffect(() => {
    if (!activeFile) return setContent(null);
    let current = true;
    const read = () =>
      fs.read(activeFile).then(
        (text) => current && setContent({ path: activeFile, text }),
        (e: unknown) => {
          const kind = e instanceof WorkspaceFsError ? e.kind : "io";
          if (current) setContent({ path: activeFile, error: t(`explorer.errors.${kind}`, { path: activeFile, detail: String(e) }) });
        },
      );
    void read();
    const unlisten = fs.onChange((paths) => paths.includes(activeFile) && void read());
    return () => {
      current = false;
      void unlisten.then((stop) => stop());
    };
  }, [fs, activeFile, t]);

  if (!activeFile) return <>{fallback}</>;
  return (
    <div className="flex h-full flex-col bg-surface-editor">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] text-text-muted">
        <span className="min-w-0 flex-1 truncate font-mono">{activeFile}</span>
        <span>{t("editorPreview.readOnly")}</span>
      </div>
      {content?.path !== activeFile ? (
        <p className="p-3 text-xs text-text-muted">{t("editorPreview.loading")}</p>
      ) : "error" in content ? (
        <p className="p-3 text-xs text-danger">{content.error}</p>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5 text-text-primary">{content.text}</pre>
      )}
    </div>
  );
}
