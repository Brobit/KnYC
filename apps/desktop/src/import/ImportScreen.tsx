// Import a project (design/04 §3, knyc.pen "Screen · Import project", #59): pick the source, see the
// quick scan (no AI), the workspace folder, what will be sent to the AI and an estimate, then start
// the analysis (a background job, #57).
import { Folder, FolderOpen, Play, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { importReport, type ExclusionReason, type ImportReport, type Job } from "@knyc/core";
import { Chip, StatusBadge } from "@/components/knyc/badges";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useJobs } from "@/jobs/jobs-context";
import { useSettings } from "@/lib/settings";
import { importBackend, type ImportBackend } from "./import-backend";

/** The folder's own name: "/home/you/code/express-notes" → "express-notes". */
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

const formatCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

interface Source {
  path: string;
  sourceHash: string;
  report: ImportReport;
}

export function ImportScreen({ onCancel, onStarted, backend = importBackend }: { onCancel: () => void; onStarted: (job: Job) => void; backend?: ImportBackend }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const jobs = useJobs();
  const [source, setSource] = useState<Source | null>(null);
  const [scanning, setScanning] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const browse = async () => {
    setError(null);
    try {
      const path = await backend.pickSource();
      if (!path) return;
      setScanning(true);
      setSource(null);
      const { scan, graph } = await backend.quickScan(path);
      setSource({ path, sourceHash: scan.hash, report: importReport(scan, graph) });
      setWorkspace(await backend.defaultWorkspace(folderName(path)));
    } catch (e) {
      setError(t("import.scanFailed", { detail: e instanceof Error ? e.message : String(e) }));
    } finally {
      setScanning(false);
    }
  };

  const change = async () => {
    const picked = await backend.pickWorkspace().catch(() => null);
    if (picked && source) setWorkspace(picked);
  };

  const start = async () => {
    if (!source || !workspace) return;
    setStarting(true);
    setError(null);
    try {
      onStarted(await jobs.startAnalysis({ source: source.path, sourceHash: source.sourceHash, name: folderName(source.path), workspace }));
    } catch (e) {
      setError(t("import.startFailed", { detail: e instanceof Error ? e.message : String(e) }));
      setStarting(false);
    }
  };

  const report = source?.report;
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-semibold text-text-primary">{t("import.title")}</h1>
        <p className="text-[13px] text-text-secondary">{t("import.intro")}</p>
      </header>

      <Field label={t("import.source")} id="import-source">
        <PathRow id="import-source" path={source?.path ?? null} placeholder={t("import.sourcePlaceholder")}>
          <Button variant="outline" onClick={() => void browse()} disabled={scanning}>
            <FolderOpen />
            {t("import.browse")}
          </Button>
        </PathRow>
        {scanning && <p className="text-xs text-text-muted">{t("import.scanning")}</p>}
        {report && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5" aria-label={t("import.quickScan")}>
            <span className="text-xs text-text-secondary">{t("import.quickScan")}</span>
            {[...report.languages, ...report.frameworks, ...report.testRunners].map((label) => (
              <Chip key={label} className="bg-surface-2 text-text-secondary">
                {label}
              </Chip>
            ))}
            <Chip className="bg-surface-2 text-text-secondary">{t("import.files", { count: report.files })}</Chip>
            <Chip className="bg-surface-2 text-text-secondary">{t("import.lines", { count: formatCount(report.lines) })}</Chip>
          </div>
        )}
      </Field>

      <Field label={t("import.workspace")} id="import-workspace" hint={t("import.workspaceHint")}>
        <PathRow id="import-workspace" path={workspace} placeholder={t("import.workspacePlaceholder")}>
          <Button variant="outline" onClick={() => void change()} disabled={!source}>
            <Folder />
            {t("import.change")}
          </Button>
        </PathRow>
      </Field>

      {report && <SentToAi report={report} />}

      {error && <p className="text-xs text-danger">{error}</p>}
      {!jobs.available && <p className="text-xs text-text-muted">{t("import.desktopOnly")}</p>}

      <footer className="flex items-center gap-2.5">
        <label className="flex items-center gap-2.5 text-xs text-text-secondary">
          <Switch checked={settings.confirmCostEstimate} onCheckedChange={(checked) => update((s) => ({ ...s, confirmCostEstimate: checked }))} />
          {t("import.alwaysEstimate")}
        </label>
        <span className="flex-1" />
        <Button variant="ghost" className="text-text-secondary" onClick={onCancel}>
          {t("import.cancel")}
        </Button>
        <Button className="h-9 px-4" disabled={!report || !workspace || starting || !jobs.available} onClick={() => void start()}>
          <Play />
          {t("import.start")}
        </Button>
      </footer>
    </div>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-semibold text-text-primary">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </section>
  );
}

function PathRow({ id, path, placeholder, children }: { id: string; path: string | null; placeholder: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <output id={id} className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5" title={path ?? undefined}>
        <Folder className="size-3.5 shrink-0 text-text-muted" aria-hidden />
        <span className={path ? "truncate font-mono text-xs text-text-primary" : "truncate text-xs text-text-muted"}>{path ?? placeholder}</span>
      </output>
      {children}
    </div>
  );
}

const REASON_TONE: Record<ExclusionReason, "danger" | "neutral"> = {
  secret: "danger",
  ignored: "neutral",
  binary: "neutral",
  lockfile: "neutral",
  "too-large": "neutral",
};

/** "a, b, c + 4 more" */
function summarizePaths(paths: string[], more: (count: number) => string) {
  const shown = paths.slice(0, 3).join(", ");
  return paths.length > 3 ? `${shown} ${more(paths.length - 3)}` : shown;
}

function SentToAi({ report }: { report: ImportReport }) {
  const { t } = useTranslation();
  const stats: [string, string][] = [
    [String(report.filesSent), t("import.filesSent")],
    [String(report.filesExcluded), t("import.filesExcluded")],
    [`≈ ${report.estimate.calls}`, t("import.aiCalls")],
    [`≈ ${report.estimate.minutes} min`, t("import.time")],
  ];
  return (
    <section className="flex flex-col gap-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="import-ai">
      <h2 id="import-ai" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Sparkles className="size-4 text-accent" aria-hidden />
        {t("import.sentTitle")}
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([value, label]) => (
          <div key={label} className="flex flex-col-reverse gap-0.5 rounded-md bg-surface-2 px-3 py-2.5">
            <dt className="text-[11px] text-text-muted">{label}</dt>
            <dd className="text-xl font-semibold text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-text-secondary">{t("import.planNote", { steps: report.estimate.steps })}</p>

      {report.excluded.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">{t("import.excluded")}</h3>
          <ul className="flex flex-col divide-y divide-border" aria-label={t("import.excluded")}>
            {report.excluded.map(({ reason, paths }) => (
              <li key={reason} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary" title={paths.join("\n")}>
                  {summarizePaths(paths, (count) => t("import.more", { count }))}
                </span>
                <StatusBadge tone={REASON_TONE[reason]}>{t(`import.reasons.${reason}`)}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-text-muted">{t("import.privacy")}</p>
    </section>
  );
}
