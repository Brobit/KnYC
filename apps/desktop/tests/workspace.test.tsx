import { createDockview, type DockviewApi } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Collapser, STRIP } from "@/workspace/collapse";
import { applyDefaultLayout, isUsableLayout, PANEL_IDS, restoreLayout, saveLayout, type PanelId } from "@/workspace/layout";

const title = (id: PanelId) => id.toUpperCase();

let host: HTMLElement;
let api: DockviewApi;

// The vanilla entry point drives the same layout code as <DockviewReact>, without React in the way.
function makeDock(): DockviewApi {
  const dock = createDockview(host, {
    createComponent: () => ({ element: document.createElement("div"), init: () => {} }),
  });
  dock.layout(1280, 760);
  return dock;
}

const groupOf = (dock: DockviewApi, id: PanelId) => dock.getPanel(id)!.group;
const groupedPanels = (dock: DockviewApi) => dock.groups.map((g) => g.panels.map((p) => p.id).sort());

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  api = makeDock();
});

afterEach(() => {
  api.dispose();
  host.remove();
});

describe("default layout", () => {
  it("places explorer, editor, the bottom tabs and the lesson", () => {
    applyDefaultLayout(api, title);
    expect(api.panels.map((p) => p.id).sort()).toEqual([...PANEL_IDS].sort());
    expect(groupedPanels(api)).toEqual(
      expect.arrayContaining([["explorer"], ["editor"], ["output", "run", "terminal"], ["lesson", "path"]]),
    );
    expect(groupOf(api, "explorer").api.width).toBe(240);
    expect(groupOf(api, "lesson").api.width).toBe(340);
    expect(groupOf(api, "terminal").api.height).toBe(220);
    expect(groupOf(api, "terminal").activePanel?.id).toBe("terminal");
    expect(api.getPanel("lesson")!.title).toBe("LESSON");
    expect(groupOf(api, "lesson").activePanel?.id).toBe("lesson");
  });
});

describe("save and restore", () => {
  it("restores a moved panel and a collapsed group after a restart", () => {
    const collapser = new Collapser();
    applyDefaultLayout(api, title, collapser);
    // The learner stacks the lesson with the terminal and collapses the explorer.
    api.getPanel("lesson")!.api.moveTo({ group: groupOf(api, "terminal") });
    const explorerWidth = groupOf(api, "explorer").api.width;
    collapser.collapse(groupOf(api, "explorer"), api);
    expect(groupOf(api, "explorer").api.width).toBe(STRIP);
    const saved = JSON.parse(JSON.stringify(saveLayout(api, collapser)));
    api.dispose();

    api = makeDock();
    const restored = new Collapser();
    expect(restoreLayout(api, saved, title, restored)).toBe(true);
    expect(groupedPanels(api)).toEqual(expect.arrayContaining([["lesson", "output", "run", "terminal"]]));
    const explorer = groupOf(api, "explorer");
    expect(restored.isCollapsed(explorer.id)).toBe(true);
    expect(explorer.api.width).toBe(STRIP);

    restored.expand(explorer);
    expect(explorer.api.width).toBe(explorerWidth);
  });

  it("falls back to the default for missing, foreign or incomplete layouts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(isUsableLayout(undefined)).toBe(false);
    expect(isUsableLayout({ grid: {}, panels: {} })).toBe(false); // a bare dockview layout, no version
    applyDefaultLayout(api, title);
    const saved = saveLayout(api, new Collapser());
    const { lesson: _, ...withoutLesson } = saved.dock.panels;
    expect(isUsableLayout({ ...saved, dock: { ...saved.dock, panels: withoutLesson } })).toBe(false);

    api.dispose();
    api = makeDock();
    expect(restoreLayout(api, { version: 1, dock: { panels: Object.fromEntries(PANEL_IDS.map((id) => [id, {}])) } }, title)).toBe(false);
    expect(api.panels).toHaveLength(PANEL_IDS.length);
    warn.mockRestore();
  });
});

describe("reset", () => {
  it("brings back the default arrangement and expands everything", () => {
    const collapser = new Collapser();
    applyDefaultLayout(api, title, collapser);
    api.getPanel("explorer")!.api.moveTo({ group: groupOf(api, "editor") });
    collapser.collapse(groupOf(api, "terminal"), api);

    applyDefaultLayout(api, title, collapser);
    expect(groupedPanels(api)).toHaveLength(4);
    expect(collapser.toJSON()).toEqual({});
    expect(groupOf(api, "terminal").api.height).toBe(220);
  });
});
