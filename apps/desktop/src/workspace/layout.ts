// The learning workspace layout (design 04 §7): panel ids, the default arrangement, save, restore and reset.
import type { DockviewApi, SerializedDockview } from "dockview-react";
import type { Collapser, CollapsedGroups } from "./collapse";

export const PANEL_IDS = ["explorer", "editor", "terminal", "run", "output", "lesson", "path"] as const;
export type PanelId = (typeof PANEL_IDS)[number];
export type PanelTitle = (id: PanelId) => string;

/** Every panel renders through the same component; its id says which one it is. */
export const PANEL_COMPONENT = "knyc-panel";

const SIZES = { explorer: 240, lesson: 340, bottom: 220 };

/** What goes into settings.json under `layout`. */
export interface SavedLayout {
  version: 1;
  dock: SerializedDockview;
  collapsed: CollapsedGroups;
}

export function saveLayout(api: DockviewApi, collapser: Collapser): SavedLayout {
  return { version: 1, dock: api.toJSON(), collapsed: collapser.toJSON() };
}

/** Explorer left, editor center with Terminal / Run / Output below it, lesson (and path map) right. */
export function applyDefaultLayout(api: DockviewApi, title: PanelTitle, collapser?: Collapser): void {
  api.clear();
  collapser?.clear();
  const add = (id: PanelId, position?: Parameters<DockviewApi["addPanel"]>[0]["position"], extra = {}) =>
    api.addPanel({ id, component: PANEL_COMPONENT, title: title(id), position, ...extra });

  add("editor");
  add("terminal", { referencePanel: "editor", direction: "below" });
  add("run", { referencePanel: "terminal", direction: "within" }, { inactive: true });
  add("output", { referencePanel: "terminal", direction: "within" }, { inactive: true });
  add("explorer", { direction: "left" });
  add("lesson", { direction: "right" });
  add("path", { referencePanel: "lesson", direction: "within" }, { inactive: true });
  // New splits share space equally; size the side and bottom groups once everything is placed.
  api.getPanel("explorer")?.group.api.setSize({ width: SIZES.explorer });
  api.getPanel("lesson")?.group.api.setSize({ width: SIZES.lesson });
  api.getPanel("terminal")?.group.api.setSize({ height: SIZES.bottom });
  api.getPanel("editor")?.api.setActive();
}

/** A saved layout is only used when it holds exactly the known panels; anything else is dropped. */
export function isUsableLayout(saved: unknown): saved is SavedLayout {
  if (!saved || typeof saved !== "object" || (saved as SavedLayout).version !== 1) return false;
  const panels = (saved as SavedLayout).dock?.panels;
  if (!panels || typeof panels !== "object") return false;
  const ids = Object.keys(panels).sort();
  return ids.length === PANEL_IDS.length && [...PANEL_IDS].sort().every((id, i) => ids[i] === id);
}

/** Restores the saved layout, or falls back to the default. Returns whether the saved one was used. */
export function restoreLayout(api: DockviewApi, saved: unknown, title: PanelTitle, collapser?: Collapser): boolean {
  if (isUsableLayout(saved)) {
    try {
      api.fromJSON(saved.dock);
      // Titles were saved in the language of that session.
      for (const id of PANEL_IDS) api.getPanel(id)?.api.setTitle(title(id));
      collapser?.restore(api, saved.collapsed);
      return true;
    } catch (error) {
      console.warn("saved layout could not be restored; using the default", error);
    }
  }
  applyDefaultLayout(api, title, collapser);
  return false;
}
