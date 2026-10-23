// Choose path (design/04 §6, knyc.pen "Screen · Choose path", #61): the track, the size and the
// setup toggle, with what the path will be on the right. "Generate my path" goes on with the same
// job (plan, timeline, checks) and back to the live view, where step 1 opens as soon as it is ready.
// M3 has one code track, so the "shared code" and "other tracks" options of the design come with M4.
import { Route } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buildUnits, pathEstimate, projectTracks, type Job, type PathSize, type TrackId } from "@knyc/core";
import { TrackBadge } from "@/components/knyc/badges";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useJobs } from "@/jobs/jobs-context";
import { cn } from "@/lib/utils";
import { TrackCards, useJobResults } from "./shared";

const SIZES: PathSize[] = ["overview", "standard", "deep"];

function Section({ number, title, sub, children }: { number: number; title: string; sub?: string; children: React.ReactNode }) {
  const id = `choose-${number}`;
  return (
    <section className="flex flex-col gap-3" aria-labelledby={id}>
      <div className="flex items-baseline gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center self-center rounded-full bg-surface-2 text-[11px] font-semibold text-text-secondary" aria-hidden>
          {number}
        </span>
        <h2 id={id} className="text-sm font-semibold text-text-primary">
          {title}
        </h2>
        {sub && <span className="text-xs text-text-muted">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-right text-text-primary">{value}</dd>
    </div>
  );
}

export function ChoosePathScreen({ jobId, track: initialTrack, onBack, onStarted }: { jobId: string; track: TrackId | null; onBack: () => void; onStarted: (job: Job) => void }) {
  const { t } = useTranslation();
  const jobs = useJobs();
  const job = jobs.jobs.find((j) => j.id === jobId);
  const { scan, graph } = useJobResults(job);
  const [track, setTrack] = useState<TrackId | null>(initialTrack ?? job?.choice?.track ?? null);
  const [size, setSize] = useState<PathSize>(job?.choice?.size ?? "standard");
  const [setupAsStep, setSetupAsStep] = useState(job?.choice?.setupAsStep ?? false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!job) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-start gap-3 px-4 py-10">
        <p className="text-sm text-text-secondary">{t("analysis.gone")}</p>
        <Button variant="outline" onClick={onBack}>
          {t("analysis.home")}
        </Button>
      </div>
    );
  }
  if (!scan || !graph) return <p className="px-12 py-10 text-sm text-text-muted">{t("overview.loading")}</p>;

  const tracks = projectTracks(scan, graph);
  const chosen = tracks.tracks.find((tr) => tr.id === track) ?? tracks.tracks[0]!;
  const units = buildUnits(graph);
  const estimates = Object.fromEntries(SIZES.map((s) => [s, pathEstimate(units, s)])) as Record<PathSize, ReturnType<typeof pathEstimate>>;
  const estimate = estimates[size];
  const steps = Math.round((estimate.steps.min + estimate.steps.max) / 2);
  // The plan, then about one call per step for the checks (design/08: M1's runs).
  const calls = 1 + steps;

  const generate = async () => {
    setStarting(true);
    setError(null);
    try {
      onStarted(await jobs.choosePath(job.id, { track: chosen.id, size, setupAsStep }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-10 px-4 py-8 lg:px-12">
      <div className="flex min-w-0 flex-1 basis-[560px] flex-col gap-7">
        <h1 className="text-[22px] font-semibold text-text-primary">{t("choose.title")}</h1>

        <Section number={1} title={t("choose.track")}>
          <TrackCards tracks={tracks} selected={chosen.id} onSelect={(id) => setTrack(id as TrackId)} row />
        </Section>

        <Section number={2} title={t("choose.size")} sub={t("choose.sizeSub")}>
          <div className="grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label={t("choose.size")}>
            {SIZES.map((s) => {
              const e = estimates[s];
              const selected = s === size;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSize(s)}
                  className={cn(
                    "flex flex-col gap-1 rounded-[10px] bg-surface px-4 py-3 text-left",
                    selected ? "border-2 border-accent bg-accent-soft" : "border border-border hover:border-border-strong",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-text-primary">{t(`choose.sizes.${s}`)}</span>
                    <span className="font-mono text-[11px] text-text-muted">{t("choose.sizeMeta", { steps: Math.round((e.steps.min + e.steps.max) / 2), hours: e.hours })}</span>
                  </span>
                  <span className="text-xs text-text-secondary">{t(`choose.sizeDescription.${s}`)}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section number={3} title={t("choose.options")}>
          <div className="flex items-center gap-4 rounded-[10px] border border-border bg-surface px-4 py-3">
            <label htmlFor="setup-as-step" className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] text-text-primary">{t("choose.setup")}</span>
              <span className="text-xs text-text-muted">{t("choose.setupDescription")}</span>
            </label>
            <Switch id="setup-as-step" checked={setupAsStep} onCheckedChange={setSetupAsStep} />
          </div>
        </Section>
      </div>

      <aside className="flex w-full flex-col gap-4 self-start rounded-[10px] border border-border bg-surface p-5 lg:w-[340px]" aria-labelledby="choose-summary">
        <h2 id="choose-summary" className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
          {t("choose.yourPath")}
        </h2>
        <div className="flex items-center gap-2">
          <TrackBadge track={chosen.id} label={t(`overview.tracks.${chosen.id}`)} />
          <span className="text-[13px] font-semibold text-text-primary">{t(`choose.sizes.${size}`)}</span>
        </div>
        <dl className="flex flex-col gap-2.5">
          <SummaryRow label={t("choose.steps")} value={t("choose.stepsValue", { count: steps })} />
          <SummaryRow label={t("choose.time")} value={t("choose.hours", { count: estimate.hours })} />
          <SummaryRow label={t("choose.checks")} value={t(scan.testRunners.length > 0 ? "choose.checksTests" : "choose.checksGenerated")} />
          <SummaryRow label={t("choose.setupRow")} value={t(setupAsStep ? "choose.setupTaught" : "choose.setupProvided")} />
          <SummaryRow label={t("choose.preparation")} value={t("choose.calls", { count: calls })} />
        </dl>
        <div className="h-px bg-border" />
        <Button className="h-[38px]" onClick={() => void generate()} disabled={starting}>
          <Route />
          {t("choose.generate")}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-text-muted">{t("choose.note")}</p>
        <Button variant="ghost" className="self-start text-text-secondary" onClick={onBack}>
          {t("choose.back")}
        </Button>
      </aside>
    </div>
  );
}
