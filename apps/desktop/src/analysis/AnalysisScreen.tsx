// The analysis, live (design/04 §4, knyc.pen "Screen · Analysis (live)", #60): each stage with its
// state, result and time, from the job's events; what was found so far on the right. The job runs
// in the background (#57): leaving this screen doesn't stop it. Once a path is chosen (#61) the same
// view shows the path stages and the steps as they become ready (design/02 D5).
import { ArrowRight, Check, Clock, LoaderCircle, Pause, Play, Route, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { importReport, PATH_STAGES, projectTracks, SECONDS_PER_CALL, stepIsReady, type Job, type JobStage, type LearningPath } from "@knyc/core";
import { Button } from "@/components/ui/button";
import type { JobResults } from "@/jobs/job-manager";
import { useJobs } from "@/jobs/jobs-context";
import { cn } from "@/lib/utils";
import { TrackCards, useJobResults } from "./shared";

const KIND: Record<string, "local" | "ai" | "runAi"> = { intake: "local", scan: "local", graph: "local", summaries: "ai", plan: "ai", timeline: "local", checks: "runAi" };

function seconds(stage: JobStage) {
  if (!stage.startedAt || !stage.finishedAt) return null;
  const s = (Date.parse(stage.finishedAt) - Date.parse(stage.startedAt)) / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
}

/** Minutes left: the summaries' estimate before a path is chosen, about one call per step after. */
function minutesLeft(job: Job, results: JobResults): number | null {
  if (job.status !== "running" || !results.scan || !results.graph) return null;
  const progress = (id: string) => {
    const stage = job.stages.find((s) => s.id === id);
    return stage?.progress && stage.progress.total > 0 ? stage.progress.done / stage.progress.total : 0;
  };
  if (job.choice) {
    if (!results.path) return null;
    const left = results.path.steps.filter((s) => !stepIsReady(s)).length;
    return Math.max(1, Math.round((left * SECONDS_PER_CALL) / 60));
  }
  const calls = importReport(results.scan, results.graph).estimate.summaryCalls;
  return Math.max(1, Math.round((calls * (1 - progress("summaries")) * SECONDS_PER_CALL) / 60));
}

function stageDetail(stage: JobStage, results: JobResults, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (stage.status === "failed") return stage.error ?? t("analysis.failed");
  if (stage.status === "paused") return t("analysis.pausedStage");
  if (stage.status === "running") {
    return stage.progress ? t(`analysis.running.${stage.id}`, { done: stage.progress.done, total: stage.progress.total }) : t(`analysis.starting.${stage.id}`);
  }
  if (stage.status === "pending") return t(`analysis.todo.${stage.id}`);
  const { scan, graph, summaries, path } = results;
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
  if (stage.id === "plan" && path) return t("analysis.done.plan", { count: path.steps.length, milestones: t("analysis.milestones", { count: path.milestones.length }) });
  if (stage.id === "timeline") return t("analysis.done.timeline");
  if (stage.id === "checks" && path) return t("analysis.done.checks", { count: path.steps.length });
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

type StepPrep = "ready" | "preparing" | "waiting";

/** The steps of the path as they are prepared: ready, the one being prepared, the ones after. */
function PathSteps({ path, job }: { path: LearningPath; job: Job }) {
  const { t } = useTranslation();
  const checks = job.stages.find((s) => s.id === "checks");
  const next = path.steps.find((s) => !stepIsReady(s));
  const prep = (step: LearningPath["steps"][number]): StepPrep =>
    stepIsReady(step) ? "ready" : step === next && checks?.status === "running" ? "preparing" : "waiting";
  const icon = {
    ready: <Check className="size-3 text-success" />,
    preparing: <LoaderCircle className="size-3 animate-spin text-accent" />,
    waiting: <Clock className="size-3 text-text-muted" />,
  };
  const steps = new Map(path.steps.map((s) => [s.id, s]));
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-4">
      {path.milestones.map((milestone) => (
        <section key={milestone.id} className="flex flex-col gap-1" aria-label={milestone.title}>
          <h3 className="text-[11px] font-semibold text-text-secondary">{milestone.title}</h3>
          <ol className="flex flex-col">
            {milestone.stepIds.map((id) => {
              const step = steps.get(id)!;
              const state = prep(step);
              return (
                <li key={id} className="flex items-center gap-2.5 rounded-[4px] px-1 py-1.5" aria-label={`${step.title}: ${t(`analysis.prep.${state}`)}`}>
                  <span className={cn("flex size-[22px] shrink-0 items-center justify-center rounded-full", state === "ready" ? "bg-success-soft" : "bg-surface-2")}>{icon[state]}</span>
                  <span className={cn("min-w-0 flex-1 truncate text-[13px]", state === "ready" ? "text-text-primary" : "text-text-secondary")}>{step.title}</span>
                  <span className={cn("shrink-0 text-[11px]", state === "preparing" ? "text-accent" : "text-text-muted")}>{t(`analysis.prep.${state}`)}</span>
                  <span className="w-7 shrink-0 text-right font-mono text-[11px] text-text-muted">{id}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function AnalysisScreen({
  jobId,
  onOverview,
  onChoosePath,
  onHome,
}: {
  jobId: string;
  onOverview: (job: Job) => void;
  onChoosePath: (job: Job) => void;
  onHome: () => void;
}) {
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
  const pathChosen = job.choice !== undefined;
  const sub = {
    running: left ? t("analysis.left", { count: left }) : t("analysis.background"),
    paused: resumeAt ? t("analysis.pausedUntil", { time: resumeAt }) : t("analysis.paused"),
    failed: t("analysis.failedSub", { reason: job.reason ?? "" }),
    cancelled: t("analysis.cancelledSub"),
    done: t(pathChosen ? "analysis.pathDoneSub" : "analysis.doneSub"),
  }[job.status];
  const title = pathChosen ? (job.status === "done" ? "analysis.pathTitleDone" : "analysis.pathTitle") : job.status === "done" ? "analysis.titleDone" : "analysis.title";
  const tracks = results.scan && results.graph ? projectTracks(results.scan, results.graph) : null;
  const path = pathChosen ? results.path : undefined;
  const firstReady = path ? stepIsReady(path.steps[0]!) : false;
  const readyCount = path ? path.steps.filter(stepIsReady).length : 0;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-wrap gap-10 px-4 py-10 lg:px-12">
      <section className="flex w-full max-w-[560px] min-w-0 flex-col gap-5" aria-labelledby="analysis-title">
        <header className="flex flex-col gap-2">
          <h1 id="analysis-title" className="text-[22px] font-semibold text-text-primary">
            {t(title, { name: job.input.name })}
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
          {/* Before a path is chosen, its stages are shown greyed so the learner sees the whole road. */}
          {!pathChosen &&
            PATH_STAGES.map((id, i) => (
              <Row key={id} number={job.stages.length + i + 1} status="later" title={t(`analysis.stage.${id}`)} detail={t("analysis.afterPath")} kind={t(`analysis.kind.${KIND[id]}`)} />
            ))}
        </ol>

        <div className="flex flex-wrap items-center gap-2.5">
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
          {job.status === "done" && !pathChosen && (
            <Button className="h-9 px-4" onClick={() => onOverview(job)}>
              {t("analysis.openOverview")}
              <ArrowRight />
            </Button>
          )}
          {pathChosen && job.stages.find((s) => s.id === "summaries")?.status === "done" && (
            <Button variant="outline" onClick={() => onChoosePath(job)}>
              <Route />
              {t("analysis.changePath")}
            </Button>
          )}
        </div>
      </section>

      <aside className="flex min-w-[300px] flex-1 flex-col gap-4" aria-labelledby="analysis-found">
        {pathChosen ? (
          <>
            <div className="flex items-baseline gap-3">
              <h2 id="analysis-found" className="flex-1 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
                {t("analysis.yourPath")}
              </h2>
              {path && <span className="text-xs text-text-secondary">{t("analysis.stepsReady", { done: readyCount, total: path.steps.length })}</span>}
            </div>
            {path ? (
              <>
                {/* Opening the workspace on step 1 is the lesson panel (#62); the step is ready here. */}
                <Button className="h-[38px]" disabled title={t("analysis.startLearningSoon")}>
                  <Play />
                  {t(firstReady ? "analysis.startLearning" : "analysis.startLearningWait")}
                </Button>
                <p className="text-[11px] text-text-muted">{t(firstReady ? "analysis.startLearningSoon" : "analysis.firstStepSoon")}</p>
                <PathSteps path={path} job={job} />
              </>
            ) : (
              <p className="rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-[13px] text-text-muted">{t("analysis.pathEmpty")}</p>
            )}
          </>
        ) : (
          <>
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
          </>
        )}
      </aside>
    </div>
  );
}
