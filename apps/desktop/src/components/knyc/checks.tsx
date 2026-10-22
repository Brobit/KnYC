// Check rows and the hint ladder (design/07, knyc.pen "Check rows", "Hint ladder").
import { Check, CircleCheck, CircleX, Circle, Eye, Lightbulb, LoaderCircle, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type CheckState = "pass" | "fail" | "running" | "pending";

const stateIcon = {
  pass: <CircleCheck className="text-success" />,
  fail: <CircleX className="text-danger" />,
  running: <LoaderCircle className="animate-spin text-accent" />,
  pending: <Circle className="text-text-muted" />,
} as const;

export function CheckRow({ state, label, meta }: { state: CheckState; label: string; meta?: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-[4px] px-2 py-1.5 [&>svg]:size-[15px] [&>svg]:shrink-0", state === "fail" && "bg-danger-soft")}>
      {stateIcon[state]}
      <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">{label}</span>
      {meta && <span className="font-mono text-[11px] text-text-muted">{meta}</span>}
    </div>
  );
}

export interface HintLadderProps {
  /** Hints already unlocked (1–3). */
  used: number;
  onHint?: (level: 1 | 2 | 3) => void;
  onReveal?: () => void;
  /** Short "Reveal" label for narrow panels. */
  compact?: boolean;
}

/** Hint 1 → 2 → 3, then reveal the original. Only the next rung is clickable. */
export function HintLadder({ used, onHint, onReveal, compact }: HintLadderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {([1, 2, 3] as const).map((level) => {
        const state = level <= used ? "used" : level === used + 1 ? "next" : "locked";
        const Icon = state === "used" ? Check : state === "next" ? Lightbulb : Lock;
        return (
          <button
            key={level}
            type="button"
            disabled={state === "locked"}
            onClick={() => state === "next" && onHint?.(level)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-[5px] text-xs font-medium [&_svg]:size-3",
              state === "used" && "bg-accent-soft text-accent",
              state === "next" && "border border-border-strong bg-surface text-text-primary hover:bg-surface-2",
              state === "locked" && "border border-border-strong bg-surface text-text-muted",
            )}
          >
            <Icon aria-hidden />
            {t("lesson.hint", { level })}
          </button>
        );
      })}
      <span className="mx-0.5 h-[18px] w-px bg-border-strong" aria-hidden />
      <button type="button" onClick={onReveal} className="inline-flex items-center gap-1 rounded-md px-2.5 py-[5px] text-xs font-medium text-text-secondary hover:bg-surface-2 [&_svg]:size-3">
        <Eye aria-hidden />
        {compact ? t("lesson.revealShort") : t("lesson.reveal")}
      </button>
    </div>
  );
}
