// The analysis, live (design/04 §4, knyc.pen "Screen · Analysis (live)", #60): each stage with its
// state, result and time, from the job's events; what was found so far on the right. The job runs
// in the background (#57): leaving this screen doesn't stop it.
import { ArrowRight, Check, LoaderCircle, Pause, Play, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { importReport, projectTracks, SECONDS_PER_CALL, type AnalysisResult, type Job, type JobStage } from "@knyc/core";
import { Button } from "@/components/ui/button";
import { useJobs } from "@/jobs/jobs-context";
import { cn } from "@/lib/utils";
import { TrackCards, useJobResults } from "./shared";

const KIND: Record<string, "local" | "ai"> = { intake: "local", scan: "local", graph: "local", summaries: "ai" };
/** Stages that come after the path is chosen (#61), shown so the learner sees the whole road. */
const PATH_STAGES = [
  ["plan", "ai"],
  ["timeline", "ai"],
  ["checks", "runAi"],
] as const;

function seconds(stage: JobStage) {
  if (!stage.startedAt || !stage.finishedAt) return null;
  const s = (Date.parse(stage.finishedAt) - Date.parse(stage.startedAt)) / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
}

/** Minutes left, from the estimate of the summaries (the only long stage before the path). */
function minutesLeft(job: Job, results: Partial<AnalysisResult>): number | null {
  if (job.status !== "running" || !results.scan || !results.graph) return null;
  const summaries = job.stages.find((s) => s.id === "summaries");
  const calls = importReport(results.scan, results.graph).estimate.summaryCalls;
  const done = summaries?.progress && summaries.progress.total > 0 ? summaries.progress.done / summaries.progress.total : 0;
  return Math.max(1, Math.round((calls * (1 - done) * SECONDS_PER_CALL) / 60));
}

function stageDetail(stage: JobStage, results: Partial<AnalysisResult>, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (stage.status === "failed") return stage.error ?? t("analysis.failed");
  if (stage.status === "paused") return t("analysis.pausedStage");
  if (stage.status === "running") {
    return stage.progress ? t(`analysis.running.${stage.id}`, { done: stage.progress.done, total: stage.progress.total }) : t(`analysis.starting.${stage.id}`);
  }
  if (stage.status === "pending") return t(`analysis.todo.${stage.id}`);
  const { scan, graph, summaries } = results;
  if (stage.id === "intake") return scan ? t("analysis.done.intakeExcluded", { count: scan.excluded.length }) : t("analysis.done.intake");
  if (stage.id === "scan" && scan && graph) {
    const report = importReport(scan, graph);
    return [...report.languages, ...report.frameworks, ...report.testRunners].join(" · ") || t("analysis.done.scan");
  }
  if (stage.id === "graph" && graph) {
    const symbols = graph.files.reduce((sum, f) => sum + f.symbols.length, 0);
    return t("analysis.done.graph", { files: graph.files.length, symbols });
  }
  if (stage.id === "summaries" && summaries) return t("analysis.done.summaries", { count: summaries.files.length });
  return t("analysis.done.generic");
}

function Badge({ status, number }: { status: JobStage["status"] | "later"; number: number }) {
  const look = {
    done: ["bg-success-soft text-success", <Check key="i" className="size-3.5" />],
    running: ["bg-accent text-on-accent", <LoaderCircle key="i" className="size-3.5 animate-spin" />],
    paused: ["bg-warning-soft text-warning", <Pause key="i" className="size-3.5" />],
    failed: ["bg-danger-soft text-danger", <X key="i" className="size-3.5" />],
    pending: ["bg-surface-2 text-text-muted", number],
    later: ["bg-surface-2 text-text-muted", number],
  }[status] as [string, ReactNode];
  return <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", look[0])}>{look[1]}</span>;
}

function Row({ number, status, title, detail, kind, time }: { number: number; status: JobStage["status"] | "later"; title: string; detail: string; kind: string; time?: string | null }) {
  const active = status === "running" || status === "paused";
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", active && "bg-accent-soft")} aria-label={title} aria-current={active ? "step" : undefined}>
      <Badge status={status} number={number} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-[13px]", status === "later" || status === "pending" ? "text-text-secondary" : "text-text-primary", active && "font-semibold")}>{title}</span>
        <span className={cn("truncate text-xs", status === "failed" ? "text-danger" : "text-text-muted")} title={detail}>
          {detail}
        </span>
      </span>
      <span className="shrink-0 text-[10px] text-text-muted">{kind}</span>
      <span className="w-12 shrink-0 text-right text-[11px] text-text-muted">{time ?? ""}</span>
    </li>
  );
}

export function AnalysisScreen({ jobId, onOverview, onHome }: { jobId: string; onOverview: (job: Job) => void; onHome: () => void }) {
  const { t, i18n } = useTranslation();
  const jobs = useJobs();
  const job = jobs.jobs.find((j) => j.id === jobId);
  const results = useJobResults(job);

  if (!job) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-start gap-3 px-4 py-10">
        <p className="text-sm text-text-secondary">{t("analysis.gone")}</p>
        <Button variant="outline" onClick={onHome}>
          {t("analysis.home")}
        </Button>
      </div>
    );
  }

  const doneCount = job.stages.filter((s) => s.status === "done").length;
  const running = job.stages.find((s) => s.status === "running");
  const inside = running?.progress && running.progress.total > 0 ? running.progress.done / running.progress.total : 0;
  const overall = (doneCount + inside) / job.stages.length;
  const left = minutesLeft(job, results);
  const resumeAt = job.resumeAt ? new Date(job.resumeAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }) : null;
  const sub = {
    running: left ? t("analysis.left", { count: left }) : t("analysis.background"),
    paused: resumeAt ? t("analysis.pausedUntil", { time: resumeAt }) : t("analysis.paused"),
    failed: t("analysis.failedSub", { reason: job.reason ?? "" }),
    cancelled: t("analysis.cancelledSub"),
    done: t("analysis.doneSub"),
  }[job.status];
  const tracks = results.scan && results.graph ? projectTracks(results.scan, results.graph) : null;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-wrap gap-10 px-4 py-10 lg:px-12">
      <section className="flex w-full max-w-[560px] min-w-0 flex-col gap-5" aria-labelledby="analysis-title">
        <header className="flex flex-col gap-2">
          <h1 id="analysis-title" className="text-[22px] font-semibold text-text-primary">
            {t(job.status === "done" ? "analysis.titleDone" : "analysis.title", { name: job.input.name })}
          </h1>
          <p className={cn("text-[13px]", job.status === "failed" ? "text-danger" : "text-text-secondary")}>{sub}</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-border-strong" role="progressbar" aria-label={t("analysis.progress")} aria-valuenow={Math.round(overall * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${overall * 100}%` }} />
          </div>
        </header>

        <ol className="divide-y divide-border overflow-hidden rounded-[10px] border border-border bg-surface" aria-label={t("analysis.stages")}>
          {job.stages.map((stage, i) => (
            <Row
              key={stage.id}
              number={i + 1}
              status={stage.status}
              title={t(`analysis.stage.${stage.id}`)}
              detail={stageDetail(stage, results, t)}
              kind={t(`analysis.kind.${KIND[stage.id] ?? "local"}`)}
              time={seconds(stage)}
            />
          ))}
          {PATH_STAGES.map(([id, kind], i) => (
            <Row key={id} number={job.stages.length + i + 1} status="later" title={t(`analysis.stage.${id}`)} detail={t("analysis.afterPath")} kind={t(`analysis.kind.${kind}`)} />
          ))}
        </ol>

        <div className="flex items-center gap-2.5">
          {(job.status === "running" || job.status === "paused") && (
            <Button variant="ghost" className="text-text-secondary" onClick={() => void jobs.cancel(job.id)}>
              <Square />
              {t("analysis.cancel")}
            </Button>
          )}
          {(job.status === "failed" || job.status === "cancelled" || job.status === "paused") && (
            <Button variant="outline" onClick={() => jobs.resume(job.id)}>
              <Play />
              {t(job.status === "paused" ? "analysis.resumeNow" : "analysis.resume")}
            </Button>
          )}
          <span className="flex-1" />
          <span className="text-xs text-text-muted">{t("analysis.aiCalls", { count: job.aiCalls })}</span>
          {job.status === "done" && (
            <Button className="h-9 px-4" onClick={() => onOverview(job)}>
              {t("analysis.openOverview")}
              <ArrowRight />
            </Button>
          )}
        </div>
      </section>

      <aside className="flex min-w-[300px] flex-1 flex-col gap-4" aria-labelledby="analysis-found">
        <h2 id="analysis-found" className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
          {t("analysis.found")}
        </h2>
        {tracks ? <TrackCards tracks={tracks} /> : <p className="rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-[13px] text-text-muted">{t("analysis.foundEmpty")}</p>}
        {results.summaries && (
          <section className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-4" aria-label={t("analysis.summary")}>
            <h3 className="text-[13px] font-semibold text-text-primary">{t("analysis.summary")}</h3>
            <p className="text-xs leading-relaxed text-text-secondary">{results.summaries.project.purpose}</p>
          </section>
        )}
      </aside>
    </div>
  );
}

