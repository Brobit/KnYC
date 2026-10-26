// Chromium for a frontend path (#89, design/06 H4): its frontend steps are checked in a real
// browser, downloaded once into KnYC's data folder. The size shows first; nothing downloads until
// the learner asks. Without it, the path still works: frontend steps get other checks.
import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { BrowserBackend } from "./browser-backend";

type State = { kind: "checking" } | { kind: "ready" } | { kind: "missing"; bytes: number | null } | { kind: "downloading"; bytes: number | null } | { kind: "failed"; bytes: number | null; error: string };

const megabytes = (bytes: number) => Math.max(1, Math.round(bytes / 1_000_000));

export function BrowserDownload({ backend }: { backend: BrowserBackend }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let live = true;
    void (async () => {
      const installed = await backend.status().then(
        (s) => s.installed,
        () => false,
      );
      if (!live) return;
      if (installed) return setState({ kind: "ready" });
      setState({ kind: "missing", bytes: null });
      const bytes = await backend.size().then(
        (s) => s.bytes || null,
        () => null,
      );
      if (live) setState((current) => (current.kind === "missing" ? { kind: "missing", bytes } : current));
    })();
    return () => {
      live = false;
    };
  }, [backend]);

  const download = async () => {
    const bytes = "bytes" in state ? state.bytes : null;
    setState({ kind: "downloading", bytes });
    try {
      const result = await backend.install();
      setState(result.installed ? { kind: "ready" } : { kind: "failed", bytes, error: result.error ?? t("choose.browser.failed") });
    } catch (e) {
      setState({ kind: "failed", bytes, error: e instanceof Error ? e.message : String(e) });
    }
  };

  if (state.kind === "checking") return null;
  const size = "bytes" in state && state.bytes ? t("choose.browser.size", { mb: megabytes(state.bytes) }) : null;
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-border bg-surface px-4 py-3" role="group" aria-labelledby="browser-title">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id="browser-title" className="text-[13px] text-text-primary">
          {t("choose.browser.title")}
        </span>
        <span className="text-xs text-text-muted">
          {state.kind === "ready"
            ? t("choose.browser.ready")
            : state.kind === "downloading"
              ? t("choose.browser.downloading", { size: size ?? "" })
              : t("choose.browser.missing", { size: size ?? t("choose.browser.sizeUnknown") })}
        </span>
        {state.kind === "failed" && (
          <span role="alert" className="text-xs text-danger">
            {state.error}
          </span>
        )}
      </div>
      {(state.kind === "missing" || state.kind === "failed") && (
        <Button variant="outline" size="sm" onClick={() => void download()}>
          <Download />
          {t(state.kind === "failed" ? "choose.browser.retry" : "choose.browser.download")}
        </Button>
      )}
      {state.kind === "downloading" && <LoaderCircle className="size-4 animate-spin text-text-muted" aria-label={t("choose.browser.downloadingLabel")} />}
    </div>
  );
}
