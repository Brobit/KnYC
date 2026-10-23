// Pieces shared by the live analysis and the project overview (#60): a job's saved results, the
// track cards and the architecture map.
import { Layers, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MAP_NODE, type AnalysisResult, type ArchitectureMap, type Job, type ProjectTracks } from "@knyc/core";
import { TrackCard } from "@/components/knyc/panels";
import { useJobs } from "@/jobs/jobs-context";

/** What the job's finished stages saved; read again whenever a stage changes state. */
export function useJobResults(job: Job | undefined): Partial<AnalysisResult> {
  const { results } = useJobs();
  const [loaded, setLoaded] = useState<Partial<AnalysisResult>>({});
  const stages = job?.stages.map((s) => s.status).join(",");
  useEffect(() => {
    if (!job) return;
    let live = true;
    void results(job).then((r) => live && setLoaded(r));
    return () => {
      live = false;
    };
    // Progress inside a stage doesn't change what is saved: only stage states matter.
  }, [job?.id, stages, results]);
  return loaded;
}

export const formatLines = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

export function TrackCards({ tracks, selected, onSelect }: { tracks: ProjectTracks; selected?: string | null; onSelect?: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2.5">
      {tracks.tracks.map((track) => {
        const shown = track.modules.slice(0, 4).join(", ");
        const description =
          track.id === "backend"
            ? t("overview.backendDescription", { count: track.modules.length, modules: track.modules.length > 4 ? `${shown}…` : shown })
            : t("overview.fullDescription");
        return (
          <TrackCard
            key={track.id}
            track={track.id}
            name={t(`overview.tracks.${track.id}`)}
            icon={track.id === "backend" ? Server : Layers}
            description={description}
            meta={[t("overview.lines", { count: formatLines(track.lines) }), t("overview.files", { count: track.files }), t("overview.hours", { count: track.hours })]}
            selected={selected === track.id}
            onSelect={onSelect ? () => onSelect(track.id) : undefined}
          />
        );
      })}
      {!tracks.hasFrontend && <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-xs text-text-secondary">{t("overview.apiOnly")}</p>}
    </div>
  );
}

const PAD = 24;

/** Boxes by layer (entry points on top), runtime imports as lines, in the theme's colors. */
export function ArchitectureMapView({ map }: { map: ArchitectureMap }) {
  const { t } = useTranslation();
  const { width: w, height: h } = MAP_NODE;
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  return (
    <svg
      role="img"
      aria-label={t("overview.mapLabel", { count: map.nodes.length })}
      viewBox={`${-PAD} ${-PAD} ${map.width + PAD * 2} ${map.height + PAD * 2}`}
      width={map.width + PAD * 2}
      height={map.height + PAD * 2}
      className="max-w-none"
    >
      {map.edges.map(({ from, to }) => {
        const a = byId.get(from);
        const b = byId.get(to);
        if (!a || !b) return null;
        // From the importer's bottom edge to the imported box's top edge, with right angles.
        const x1 = a.x + w / 2;
        const y1 = a.y + h;
        const x2 = b.x + w / 2;
        const y2 = b.y;
        // The horizontal part runs in the gap under the importer's row, never across a row of boxes
        // (vertical parts pass behind boxes: they are drawn after the lines).
        const mid = y1 + Math.min(MAP_NODE.gapY / 2, Math.max(12, (y2 - y1) / 2));
        return <path key={`${from}>${to}`} d={`M${x1} ${y1} V${mid} H${x2} V${y2}`} fill="none" stroke="var(--border-strong)" strokeWidth={1.5} />;
      })}
      {map.nodes.map((node) => (
        <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
          <title>{node.id}</title>
          <rect width={w} height={h} rx={6} fill="var(--surface-2)" stroke="var(--track-backend)" strokeWidth={1.25} />
          <text x={12} y={node.sub ? 21 : 30} fontSize={12} fontWeight={600} fill="var(--text-primary)" fontFamily="var(--font-code)">
            {node.label}
          </text>
          {node.sub && (
            <text x={12} y={37} fontSize={11} fill="var(--text-muted)" fontFamily="var(--font-ui)">
              {node.sub}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
