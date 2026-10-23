// The dockable learning workspace (design 04 §7, "Movable panels"). The Output panel is still a
// placeholder until its issue lands.
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { BookOpen, ChevronsDownUp, ChevronsUpDown, Code, FolderTree, Play, Route, ScrollText, Terminal, type LucideIcon } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterCommands } from "@/commands/commands";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { useTheme } from "@/lib/theme";
import { Explorer } from "@/explorer/Explorer";
import { Collapser } from "./collapse";
import { EditorPanel } from "@/editor/EditorPanel";
import { LessonPanel } from "@/learn/LessonPanel";
import { PathPanel } from "@/learn/PathPanel";
import { RunPanel } from "@/run/RunPanel";
import { TerminalPanel } from "@/terminal/TerminalPanel";
import { applyDefaultLayout, PANEL_COMPONENT, PANEL_IDS, restoreLayout, saveLayout, type PanelId, type PanelTitle } from "./layout";
import { PanelContext, type PanelControls } from "./panel-context";

const ICONS: Record<PanelId, LucideIcon> = {
  explorer: FolderTree,
  editor: Code,
  terminal: Terminal,
  run: Play,
  output: ScrollText,
  lesson: BookOpen,
  path: Route,
};

/** Saving waits for the layout to settle, so a drag or resize writes settings.json once. */
const SAVE_DELAY_MS = 400;

const CollapserContext = createContext<Collapser | null>(null);

function Placeholder({ id }: { id: PanelId }) {
  const { t } = useTranslation();
  const Icon = ICONS[id];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-6 text-center">
      <Icon className="size-5 text-text-muted" aria-hidden />
      <p className="max-w-[260px] text-xs text-text-muted">{t(`workspace.placeholder.${id}`)}</p>
    </div>
  );
}

/** Routes each panel id to its content; the rest stay placeholders until their issues land. */
function Panel({ api }: IDockviewPanelProps) {
  const id = api.id as PanelId;
  if (id === "explorer") return <Explorer />;
  if (id === "editor") return <EditorPanel empty={<Placeholder id={id} />} />;
  if (id === "run") return <RunPanel empty={<Placeholder id={id} />} />;
  if (id === "terminal") return <TerminalPanel empty={<Placeholder id={id} />} panelApi={api} />;
  if (id === "lesson") return <LessonPanel empty={<Placeholder id={id} />} />;
  if (id === "path") return <PathPanel empty={<Placeholder id={id} />} />;
  return <Placeholder id={id} />;
}

/** Tabs carry an icon and no close button: the workspace always holds every panel. */
function Tab({ api }: IDockviewPanelHeaderProps) {
  const Icon = ICONS[api.id as PanelId];
  return (
    <span className="flex h-full items-center gap-1.5 px-1 text-xs" title={api.title}>
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      <span className="knyc-tab-title truncate">{api.title}</span>
    </span>
  );
}

function GroupActions({ group, containerApi }: IDockviewHeaderActionsProps) {
  const { t } = useTranslation();
  const collapser = useContext(CollapserContext)!;
  const collapsed = useSyncExternalStore(collapser.subscribe, () => collapser.isCollapsed(group.id));
  const axis = collapser.axisFor(group, containerApi);

  const label = collapsed ? t("workspace.expand") : t("workspace.collapse");
  const Icon = collapsed ? ChevronsUpDown : ChevronsDownUp;
  return (
    <div className="flex items-center justify-center p-1">
      <Button variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={() => collapser.toggle(group, containerApi)}>
        <Icon className={axis === "width" ? "rotate-90" : undefined} />
      </Button>
    </div>
  );
}

const COMPONENTS = { [PANEL_COMPONENT]: Panel };

/** Panels with a "Toggle" command, and its shortcut. */
const TOGGLES: [PanelId, string?][] = [["explorer", "Mod+B"], ["terminal", "Mod+J"], ["lesson"]];

export function Workspace() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const { resolvedMode } = useTheme();
  const [collapser] = useState(() => new Collapser());
  const [api, setApi] = useState<DockviewApi | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedLayout = useRef(settings.layout);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const title: PanelTitle = (id) => t(`workspace.panels.${id}`);

  const panels = useMemo<PanelControls>(
    () => ({
      show: (id) => {
        const panel = api?.getPanel(id);
        if (!panel) return;
        collapser.expand(panel.group);
        panel.api.setActive();
      },
    }),
    [api, collapser],
  );

  useRegisterCommands(
    () =>
      api
        ? [
            { id: "view.resetLayout", title: t("workspace.resetLayout"), group: "view", scope: "workspace", run: () => applyDefaultLayout(api, title, collapser) },
            ...PANEL_IDS.map((id) => ({
              id: `view.show.${id}`,
              title: t("commands.showPanel", { panel: title(id) }),
              group: "view" as const,
              scope: "workspace" as const,
              run: () => panels.show(id),
            })),
            ...TOGGLES.map(([id, shortcut]) => ({
              id: `view.toggle.${id}`,
              title: t("commands.togglePanel", { panel: title(id) }),
              group: "view" as const,
              shortcuts: shortcut ? [shortcut] : undefined,
              scope: "workspace" as const,
              run: () => {
                const group = api.getPanel(id)?.group;
                if (group) collapser.toggle(group, api);
              },
            })),
          ]
        : [],
    [api, t],
  );

  const theme: DockviewTheme = {
    name: "knyc",
    // dockview-theme-light carries the structural variables; ours overrides every color.
    className: "dockview-theme-light dockview-theme-knyc",
    colorScheme: resolvedMode,
  };

  const ready = ({ api }: DockviewReadyEvent) => {
    restoreLayout(api, savedLayout.current, title, collapser);
    api.onDidLayoutChange(() => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const layout = saveLayout(api, collapser);
        update((current) => ({ ...current, layout }));
      }, SAVE_DELAY_MS);
    });
    setApi(api);
  };

  return (
    <PanelContext.Provider value={panels}>
      <CollapserContext.Provider value={collapser}>
        <DockviewReact
          className="h-full"
          theme={theme}
          components={COMPONENTS}
          defaultTabComponent={Tab}
          rightHeaderActionsComponent={GroupActions}
          disableFloatingGroups
          // Hidden tabs stay mounted: the editor keeps its state and terminals keep running.
          defaultRenderer="always"
          onReady={ready}
        />
      </CollapserContext.Provider>
    </PanelContext.Provider>
  );
}
