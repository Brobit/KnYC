// Panel chrome, file-tree rows and track cards (design/07, knyc.pen).
import type { LucideIcon } from "lucide-react";
import { Dot, Ellipsis, FileCode, GripHorizontal, Lock, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import type { TrackId } from "@knyc/core/schemas";
import { cn } from "@/lib/utils";
import { trackDot } from "./badges";

/** Draggable header of a dockable panel: "EXPLORER". */
export function PanelHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex h-[34px] items-center gap-2 border-b border-border bg-surface-2 px-3">
      <span className="flex-1 truncate text-[11px] font-semibold tracking-[0.06em] text-text-secondary uppercase">{title}</span>
      {actions}
      <GripHorizontal className="size-3.5 text-text-muted" aria-hidden />
      <Ellipsis className="size-3.5 text-text-muted" aria-hidden />
    </div>
  );
}

/** A tab of a panel strip; the active one has the accent underline. */
export function PanelTab({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={cn(
        "inline-flex items-center gap-1.5 border-b-2 px-3 py-[7px] text-xs font-medium",
        active ? "border-accent text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary",
      )}
    >
      <Icon className={cn("size-[13px]", active ? "text-text-primary" : "text-text-muted")} aria-hidden />
      {label}
    </button>
  );
}

export type TreeRowState = "normal" | "provided" | "touched" | "editing";

/** A file or folder in the Explorer. Indentation is the row's depth. */
export function TreeRow({ name, icon: Icon = FileCode, depth = 0, state = "normal", onClick }: { name: string; icon?: LucideIcon; depth?: number; state?: TreeRowState; onClick?: () => void }) {
  const tone = state === "provided" ? "text-text-muted" : state === "normal" ? "text-text-primary" : "text-accent";
  const Trailing = state === "provided" ? Lock : state === "editing" ? Pencil : state === "touched" ? Dot : null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={cn("flex w-full items-center gap-1.5 rounded-[4px] py-1 pr-2 text-left hover:bg-surface", state === "editing" && "bg-accent-soft")}
    >
      <Icon className={cn("size-3.5 shrink-0", state === "normal" ? "text-text-secondary" : tone)} aria-hidden />
      <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", tone)}>{name}</span>
      {Trailing && <Trailing className={cn("size-3.5 shrink-0", tone)} aria-hidden />}
    </button>
  );
}

export interface TrackCardProps {
  track: TrackId;
  name: string;
  icon: LucideIcon;
  description: string;
  meta: string[];
  selected?: boolean;
  onSelect?: () => void;
}

export function TrackCard({ track, name, icon: Icon, description, meta, selected, onSelect }: TrackCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col gap-3 rounded-[10px] bg-surface p-4 text-left",
        selected ? "border-2 border-accent bg-accent-soft" : "border border-border hover:border-border-strong",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("size-2.5 rounded-[3px]", trackDot(track))} aria-hidden />
        <span className="flex-1 text-[15px] font-semibold text-text-primary">{name}</span>
        <Icon className={cn("size-4", selected ? "text-accent" : "text-text-muted")} aria-hidden />
      </span>
      <span className="text-xs leading-[1.45] text-text-secondary">{description}</span>
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        {meta.map((m) => (
          <span key={m} className="font-mono text-[11px] text-text-muted">
            {m}
          </span>
        ))}
      </span>
    </button>
  );
}
