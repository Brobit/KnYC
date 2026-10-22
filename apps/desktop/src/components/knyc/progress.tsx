// Path progress and step items (design/07, knyc.pen "Path progress", "Cards & lists").
import { ArrowRight, Check, Lock, SkipForward } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type StepState = "passed" | "current" | "skipped" | "locked";

/** One segment per step: done, current, to do. */
export function PathProgress({ total, current, className }: { total: number; current: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex flex-1 items-center gap-[3px]" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-[3px]", i + 1 < current ? "bg-success" : i + 1 === current ? "bg-accent" : "bg-border-strong")} />
        ))}
      </div>
      <span className="text-xs font-medium whitespace-nowrap text-text-secondary">{t("path.stepOf", { current, total })}</span>
    </div>
  );
}

const badge = {
  passed: { box: "bg-success-soft", icon: <Check className="text-success" /> },
  current: { box: "bg-accent", icon: <ArrowRight className="text-on-accent" /> },
  skipped: { box: "bg-surface-2", icon: <SkipForward className="text-text-secondary" /> },
  locked: { box: "bg-surface-2", icon: <Lock className="text-text-muted" /> },
} as const;

export function StepItem({ state, title, id }: { state: StepState; title: string; id: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-[4px] px-2 py-1.5", state === "current" && "bg-accent-soft")}>
      <span className={cn("flex size-[22px] shrink-0 items-center justify-center rounded-full [&_svg]:size-3", badge[state].box)}>{badge[state].icon}</span>
      <span className={cn("min-w-0 flex-1 truncate text-[13px]", state === "locked" ? "text-text-muted" : "text-text-primary", state === "current" && "font-semibold")}>
        {title}
      </span>
      <span className="font-mono text-[11px] text-text-muted">{id}</span>
    </div>
  );
}
