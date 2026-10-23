// The analyses KnYC knows about, on Home (#59): where each one is, and cancel / resume / remove.
// The live analysis view (#60) shows one in full.
import { CircleCheck, CircleX, LoaderCircle, Pause, Play, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Job } from "@knyc/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOptionalJobs } from "./jobs-context";

/** The stage the job is at (the first one not done), and its progress when it has items. */
function currentStage(job: Job) {
  return job.stages.find((s) => s.status !== "done") ?? job.stages[job.stages.length - 1];
}

function JobRow({ job, onOpen }: { job: Job; onOpen?: (job: Job) => void }) {
  const { t, i18n } = useTranslation();
  const jobs = useOptionalJobs()!;
  const stage = currentStage(job);
  const StatusIcon = { running: LoaderCircle, paused: Pause, failed: CircleX, cancelled: Square, done: CircleCheck }[job.status];
  const tone = { running: "text-accent", paused: "text-warning", failed: "text-danger", cancelled: "text-text-muted", done: "text-success" }[job.status];
  const resumeAt = job.resumeAt ? new Date(job.resumeAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }) : null;

  let detail: string;
  if (job.status === "done") detail = t("analyses.done");
  else if (job.status === "paused") detail = resumeAt ? t("analyses.pausedUntil", { time: resumeAt }) : t("analyses.paused");
  else if (job.status === "failed") detail = t("analyses.failed", { reason: job.reason ?? "" });
  else if (job.status === "cancelled") detail = t("analyses.cancelled");
  else {
    const progress = stage.progress ? ` · ${stage.progress.done}/${stage.progress.total}` : "";
    detail = `${t(`analyses.stages.${stage.id}`)}${progress}`;
  }

  const active = job.status === "running" || job.status === "paused";
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" aria-label={job.input.name}>
      <StatusIcon className={cn("size-4 shrink-0", tone, job.status === "running" && "animate-spin")} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {onOpen ? (
          <button type="button" className="truncate text-left font-mono text-[13px] text-text-primary hover:underline" onClick={() => onOpen(job)}>
            {job.input.name}
          </button>
        ) : (
          <span className="truncate font-mono text-[13px] text-text-primary">{job.input.name}</span>
        )}
        <span className={cn("truncate text-xs", job.status === "failed" ? "text-danger" : "text-text-muted")} title={job.reason}>
          {detail}
        </span>
      </span>
      {active && (
        <Button variant="ghost" size="sm" onClick={() => void jobs.cancel(job.id)}>
          <Square />
          {t("analyses.cancel")}
        </Button>
      )}
      {(job.status === "paused" || job.status === "failed" || job.status === "cancelled") && (
        <Button variant="ghost" size="sm" onClick={() => jobs.resume(job.id)}>
          <Play />
          {t(job.status === "paused" ? "analyses.resumeNow" : "analyses.resume")}
        </Button>
      )}
      {!active && (
        <Button variant="ghost" size="icon-sm" aria-label={t("analyses.remove", { name: job.input.name })} title={t("analyses.remove", { name: job.input.name })} onClick={() => void jobs.remove(job.id)}>
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

export function AnalysesList({ onOpen }: { onOpen?: (job: Job) => void }) {
  const { t } = useTranslation();
  const jobs = useOptionalJobs();
  if (!jobs || jobs.jobs.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="home-analyses">
      <h2 id="home-analyses" className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
        {t("analyses.title")}
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-[10px] border border-border bg-surface" aria-labelledby="home-analyses">
        {[...jobs.jobs].reverse().map((job) => (
          <JobRow key={job.id} job={job} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}
