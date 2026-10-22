// Collapsing a group shrinks it to its tab strip: a side group becomes a column of vertical tabs,
// a bottom (or top) group a single row. dockview does not serialize this, so the state is saved
// next to the layout, keyed by group id, and re-applied on restore.
import type { DockviewApi, DockviewGroupPanel } from "dockview-react";

export const STRIP = 32;
/** dockview's own minimum group size, lifted while a group is collapsed. */
const MIN_GROUP = 100;

export interface CollapsedGroup {
  axis: "width" | "height";
  /** Which way the tabs face when collapsed on the width axis. */
  side: "left" | "right";
  /** The size to come back to when expanded. */
  expandedSize: number;
}
export type CollapsedGroups = Record<string, CollapsedGroup>;

export class Collapser {
  private state: CollapsedGroups = {};
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isCollapsed = (groupId: string) => groupId in this.state;

  /** Bottom and top groups collapse their height; groups that span the full height collapse their width. */
  axisFor(group: DockviewGroupPanel, container: DockviewApi): CollapsedGroup["axis"] {
    return group.api.height < container.height - 1 ? "height" : "width";
  }

  toggle(group: DockviewGroupPanel, container: DockviewApi): void {
    if (this.isCollapsed(group.id)) this.expand(group);
    else this.collapse(group, container);
  }

  collapse(group: DockviewGroupPanel, container: DockviewApi): void {
    const axis = this.axisFor(group, container);
    const rect = group.element.getBoundingClientRect();
    const containerRect = group.element.closest(".dv-dockview")?.getBoundingClientRect();
    const side = containerRect && rect.left + rect.width / 2 > containerRect.left + containerRect.width / 2 ? "right" : "left";
    this.state[group.id] = { axis, side, expandedSize: axis === "width" ? group.api.width : group.api.height };
    this.apply(group, this.state[group.id]);
    this.emit();
  }

  expand(group: DockviewGroupPanel): void {
    const entry = this.state[group.id];
    if (!entry) return;
    delete this.state[group.id];
    group.element.classList.remove("knyc-collapsed", `knyc-collapsed-${entry.axis}`);
    if (entry.axis === "width") group.api.setHeaderPosition("top");
    group.api.setConstraints({ minimumWidth: MIN_GROUP, minimumHeight: MIN_GROUP });
    group.api.setSize({ [entry.axis]: entry.expandedSize });
    this.emit();
  }

  toJSON(): CollapsedGroups {
    return { ...this.state };
  }

  /** Re-applies saved collapses to a freshly restored layout; unknown groups are dropped. */
  restore(api: DockviewApi, saved: CollapsedGroups | undefined): void {
    this.state = {};
    for (const [id, entry] of Object.entries(saved ?? {})) {
      const group = api.getGroup(id) as DockviewGroupPanel | undefined;
      if (!group) continue;
      this.state[id] = entry;
      this.apply(group, entry);
    }
    this.emit();
  }

  clear(): void {
    this.state = {};
    this.emit();
  }

  private apply(group: DockviewGroupPanel, entry: CollapsedGroup): void {
    group.element.classList.add("knyc-collapsed", `knyc-collapsed-${entry.axis}`);
    if (entry.axis === "width") group.api.setHeaderPosition(entry.side);
    group.api.setConstraints(entry.axis === "width" ? { minimumWidth: STRIP } : { minimumHeight: STRIP });
    group.api.setSize({ [entry.axis]: STRIP });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
