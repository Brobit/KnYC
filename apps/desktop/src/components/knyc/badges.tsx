// Chips and badges (design/07, knyc.pen "Chips & badges").
import type { ReactNode } from "react";
import type { TrackId } from "@knyc/core/schemas";
import { cn } from "@/lib/utils";

/** A concept taught by a step: "dependency injection". */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-[4px] bg-accent-2-soft px-2 py-[3px] text-[11px] font-medium text-accent-2", className)}>
      {children}
    </span>
  );
}

const trackColor: Record<Exclude<TrackId, "full">, string> = {
  frontend: "bg-track-frontend",
  backend: "bg-track-backend",
  database: "bg-track-database",
  deployment: "bg-track-deployment",
};

export function trackDot(track: TrackId) {
  return track === "full" ? "bg-accent" : trackColor[track];
}

export function TrackBadge({ track, label }: { track: TrackId; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface px-2 py-[3px] text-[11px] font-medium text-text-primary">
      <span className={cn("size-2 rounded-full", trackDot(track))} aria-hidden />
      {label}
    </span>
  );
}

const tones = {
  warning: "bg-warning-soft text-warning",
  neutral: "bg-surface-2 text-text-secondary",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
} as const;

/** "Weak check", "Skipped", "Revealed"… */
export function StatusBadge({ tone, icon, children }: { tone: keyof typeof tones; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[4px] px-2 py-[3px] text-[11px] font-medium [&_svg]:size-3", tones[tone])}>
      {icon}
      {children}
    </span>
  );
}
