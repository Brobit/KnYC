// The Run panel (issue #35): the project's commands without typing them. Each command keeps its
// last run: live output, exit status and duration; Stop kills its whole process tree.
import { CircleCheck, CircleX, Download, FlaskConical, Hammer, LoaderCircle, Play, RefreshCw, Square, SquareTerminal, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/workspace/workspace-context";
import { OutputView } from "./OutputView";
import { runBackend, type PackageCommands, type ProjectCommand, type RunBackend } from "./run-backend";

/** Kept output per run; beyond this the oldest output goes (dev servers print forever). */
const MAX_OUTPUT_CHARS = 2_000_000;

/** A run's output, appended without re-rendering the panel; the output view follows it. */
export class RunOutput {
  chunks: string[] = [];
  private size = 0;
  private listeners = new Set<(chunk: string) => void>();

  append(chunk: string) {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > MAX_OUTPUT_CHARS && this.chunks.length > 1) this.size -= this.chunks.shift()!.length;
    for (const listener of this.listeners) listener(chunk);
  }

  subscribe(listener: (chunk: string) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

export interface RunRecord {
  status: "running" | "succeeded" | "failed" | "stopped";
  runId: number | null;
  exitCode: number | null;
  durationMs: number | null;
  output: RunOutput;
}

const ICONS: Record<ProjectCommand["kind"], LucideIcon> = {
  install: Download,
  build: Hammer,
  test: FlaskConical,
  run: Play,
  script: SquareTerminal,
};

const keyOf = (root: string, command: ProjectCommand) => `${root}\u0000${command.command}`;

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function RunPanel({ empty, backend = runBackend }: { empty: ReactNode; backend?: RunBackend }) {
  const { t } = useTranslation();
  const { folder, fs } = useWorkspace();
  const { settings } = useSettings();
  const { name: theme, resolvedMode } = useTheme();
  const [packages, setPackages] = useState<PackageCommands[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Map<string, RunRecord>>(() => new Map());
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    backend.commands().then(
      (found) => {
        setPackages(found);
        setError(null);
      },
      (e: unknown) => setError(String(e)),
    );
  }, [backend]);

  // A new folder: its own commands, and the old runs are gone (Rust stopped them).
  useEffect(() => {
    setPackages(null);
    setRuns(new Map());
    setSelected(null);
    if (!folder) return;
    load();
    const unlisten = fs.onChange((paths) => paths.some((p) => p === "package.json" || p.endsWith("/package.json")) && load());
    return () => void unlisten.then((stop) => stop());
  }, [folder, fs, load]);

  const update = (key: string, change: Partial<RunRecord>) =>
    setRuns((current) => {
      const record = current.get(key);
      return record ? new Map(current).set(key, { ...record, ...change }) : current;
    });

  const start = async (root: string, command: ProjectCommand) => {
    const key = keyOf(root, command);
    const output = new RunOutput();
    setRuns((current) => new Map(current).set(key, { status: "running", runId: null, exitCode: null, durationMs: null, output }));
    setSelected(key);
    try {
      const runId = await backend.start(command.command, root, (event) => {
        if (event.type === "output") output.append(event.data);
        else
          update(key, {
            status: event.stopped ? "stopped" : event.exitCode === 0 ? "succeeded" : "failed",
            exitCode: event.exitCode,
            durationMs: event.durationMs,
            runId: null,
          });
      });
      setRuns((current) => {
        const record = current.get(key);
        // A very short command may already be done.
        return record && record.status === "running" ? new Map(current).set(key, { ...record, runId }) : current;
      });
    } catch (e) {
      output.append(`\x1b[31m${t("run.failedToStart", { detail: String(e) })}\x1b[0m\n`);
      update(key, { status: "failed" });
    }
  };

  const stop = (key: string) => {
    const runId = runs.get(key)?.runId;
    if (runId != null) void backend.stop(runId);
  };

  if (!folder) return <>{empty}</>;

  const selectedRecord = selected ? (runs.get(selected) ?? null) : null;
  const selectedCommand = packages?.flatMap((p) => p.commands.map((c) => ({ key: keyOf(p.root, c), c }))).find((x) => x.key === selected)?.c;
  const showPackageNames = (packages?.length ?? 0) > 1;

  return (
    <div className="flex h-full bg-surface">
      <div className="flex w-[260px] shrink-0 flex-col border-r border-border">
        <div className="flex h-7 shrink-0 items-center border-b border-border pr-1 pl-3">
          <span className="flex-1 text-[11px] font-semibold tracking-[0.06em] text-text-secondary uppercase">{t("run.commands")}</span>
          <Button variant="ghost" size="icon-xs" aria-label={t("run.reload")} title={t("run.reload")} onClick={load}>
            <RefreshCw />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1" role="list" aria-label={t("run.commands")}>
          {error && <p className="px-3 py-2 text-xs text-danger">{t("run.scanFailed", { detail: error })}</p>}
          {packages === null && !error && <p className="px-3 py-2 text-xs text-text-muted">{t("run.loading")}</p>}
          {packages?.length === 0 && <p className="px-3 py-2 text-xs text-text-muted">{t("run.none")}</p>}
          {packages?.map((pkg) => (
            <div key={pkg.root}>
              {showPackageNames && (
                <p className="px-3 pt-2 pb-1 font-mono text-[11px] text-text-muted">{pkg.root === "." ? (pkg.name ?? "./") : pkg.root}</p>
              )}
              {pkg.commands.map((command) => {
                const key = keyOf(pkg.root, command);
                return (
                  <CommandRow
                    key={key}
                    command={command}
                    record={runs.get(key)}
                    selected={key === selected}
                    onSelect={() => setSelected(key)}
                    onStart={() => void start(pkg.root, command)}
                    onStop={() => stop(key)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-surface-editor">
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px]">
          <span className="min-w-0 flex-1 truncate font-mono text-text-secondary">{selectedCommand?.command ?? t("run.pick")}</span>
          {selectedRecord && <StatusText record={selectedRecord} />}
        </div>
        <div className="relative min-h-0 flex-1">
          <OutputView output={selectedRecord?.output ?? null} theme={theme} mode={resolvedMode} fontSize={settings.editor.fontSize} />
        </div>
      </div>
    </div>
  );
}

function StatusText({ record }: { record: RunRecord }) {
  const { t } = useTranslation();
  const duration = record.durationMs !== null ? formatDuration(record.durationMs) : "";
  const text = {
    running: t("run.running"),
    succeeded: t("run.succeeded", { duration }),
    failed: record.exitCode === null ? t("run.failedNoCode", { duration }) : t("run.failed", { code: record.exitCode, duration }),
    stopped: t("run.stopped", { duration }),
  }[record.status];
  const tone = { running: "text-accent", succeeded: "text-success", failed: "text-danger", stopped: "text-text-muted" }[record.status];
  return <span className={cn("shrink-0", tone)}>{text}</span>;
}

interface CommandRowProps {
  command: ProjectCommand;
  record?: RunRecord;
  selected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
}

function CommandRow({ command, record, selected, onSelect, onStart, onStop }: CommandRowProps) {
  const { t } = useTranslation();
  const Icon = ICONS[command.kind];
  const running = record?.status === "running";
  const label = command.kind === "script" ? command.name : t(`run.kinds.${command.kind}`);
  const StatusIcon = running ? LoaderCircle : record?.status === "succeeded" ? CircleCheck : record?.status === "failed" ? CircleX : null;
  return (
    <div
      role="listitem"
      aria-label={label}
      onClick={onSelect}
      className={cn("group flex cursor-pointer items-center gap-2 py-1 pr-1 pl-3", selected ? "bg-surface-2" : "hover:bg-surface-2")}
    >
      <Icon className="size-3.5 shrink-0 text-text-muted" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs text-text-primary">{label}</span>
        <span className="truncate font-mono text-[11px] text-text-muted" title={command.command}>
          {command.command}
        </span>
      </span>
      {StatusIcon && (
        <StatusIcon
          className={cn("size-3.5 shrink-0", running ? "animate-spin text-accent" : record?.status === "succeeded" ? "text-success" : "text-danger")}
          aria-label={t(`run.status.${record!.status}`)}
        />
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={running ? t("run.stopNamed", { name: label }) : t("run.startNamed", { name: label })}
        title={running ? t("run.stop") : t("run.start")}
        onClick={(e) => {
          e.stopPropagation();
          (running ? onStop : onStart)();
        }}
      >
        {running ? <Square className="text-danger" /> : <Play />}
      </Button>
    </div>
  );
}
