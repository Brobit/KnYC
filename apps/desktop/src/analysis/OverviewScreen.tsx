// The project overview (design/04 §5, knyc.pen "Screen · Project overview", #60): what the project
// is, its architecture map from the code graph, and the tracks the learner can rebuild. Choosing a
// path (size, setup toggle) is the next screen (#61).
import { Route } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { architectureMap, importReport, projectTracks, type Job, type TrackId } from "@knyc/core";
import { Chip } from "@/components/knyc/badges";
import { Button } from "@/components/ui/button";
import { useJobs } from "@/jobs/jobs-context";
import { ArchitectureMapView, TrackCards, useJobResults } from "./shared";

export function OverviewScreen({ jobId, onHome, onChoosePath }: { jobId: string; onHome: () => void; onChoosePath: (job: Job, track: TrackId) => void }) {
  const { t } = useTranslation();
  const jobs = useJobs();
  const job: Job | undefined = jobs.jobs.find((j) => j.id === jobId);
  const { scan, graph, summaries } = useJobResults(job);
  const [track, setTrack] = useState<TrackId | null>(null);

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
  if (!scan || !graph) return <p className="px-12 py-10 text-sm text-text-muted">{t("overview.loading")}</p>;

  const report = importReport(scan, graph);
  const tracks = projectTracks(scan, graph);
  const map = architectureMap(graph, summaries);
  const stack = [...report.languages, ...report.frameworks, ...report.testRunners];

  return (
    <div className="flex flex-wrap gap-8 px-4 py-8 lg:px-12">
      <div className="flex min-w-0 flex-1 basis-[560px] flex-col gap-5">
        <header className="flex flex-col gap-2.5">
          <h1 className="font-mono text-[22px] font-semibold text-text-primary">{job.input.name}</h1>
          <div className="flex flex-wrap gap-1.5" aria-label={t("overview.stack")}>
            {stack.map((label) => (
              <Chip key={label} className="bg-surface-2 text-text-secondary">
                {label}
              </Chip>
            ))}
          </div>
          {summaries && (
            <p className="max-w-[900px] text-[13px] leading-relaxed text-text-secondary">
              {summaries.project.purpose} {summaries.project.architecture}
            </p>
          )}
        </header>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-border bg-surface" aria-labelledby="overview-map">
          <div className="flex items-center gap-4 border-b border-border px-4 py-3">
            <h2 id="overview-map" className="flex-1 text-[13px] font-semibold text-text-primary">
              {t("overview.architecture")}
            </h2>
            <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
              <span className="size-2 rounded-[2px] bg-track-backend" aria-hidden />
              {t("overview.tracks.backend")}
            </span>
            <span className="text-[11px] text-text-muted">{t(map.level === "file" ? "overview.byFile" : "overview.byFolder")}</span>
          </div>
          <div className="flex justify-center overflow-auto p-2">
            <ArchitectureMapView map={map} />
          </div>
        </section>
      </div>

      <aside className="flex w-full flex-col gap-3 lg:w-[340px]" aria-labelledby="overview-tracks">
        <h2 id="overview-tracks" className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
          {t("overview.tracksTitle")}
        </h2>
        <TrackCards tracks={tracks} selected={track} onSelect={(id) => setTrack(id as TrackId)} />
        <Button className="h-[38px]" onClick={() => onChoosePath(job, track ?? tracks.tracks[0]!.id)}>
          <Route />
          {t("overview.choosePath")}
        </Button>
      </aside>
    </div>
  );
}
