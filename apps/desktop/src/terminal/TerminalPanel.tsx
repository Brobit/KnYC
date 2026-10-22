// The Terminal panel (issue #34): shells in the workspace folder, several as tabs. A new folder
// starts over with one fresh terminal (Rust kills the old shells).
import type { DockviewPanelApi } from "dockview-react";
import { Plus, SquareTerminal, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterCommands } from "@/commands/commands";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useShowPanel } from "@/workspace/panel-context";
import { useWorkspace } from "@/workspace/workspace-context";
import { terminalBackend, type TerminalBackend } from "./terminal-backend";
import { TerminalView } from "./TerminalView";

interface TerminalTab {
  key: number;
  number: number;
  exited: boolean;
}

let nextKey = 0;

interface TerminalPanelProps {
  empty: ReactNode;
  backend?: TerminalBackend;
  /** The dockview panel hosting this one: showing it gives the keyboard to the active terminal. */
  panelApi?: Pick<DockviewPanelApi, "onDidActiveChange">;
}

export function TerminalPanel({ empty, backend = terminalBackend, panelApi }: TerminalPanelProps) {
  const { t } = useTranslation();
  const { folder } = useWorkspace();
  const { settings } = useSettings();
  const { name: theme, resolvedMode } = useTheme();
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const showPanel = useShowPanel("terminal");

  // dockview moves focus to its own container when a tab is shown; take it back afterwards.
  useEffect(() => {
    if (!panelApi) return;
    const subscription = panelApi.onDidActiveChange(({ isActive }) => isActive && setFocusRequest((n) => n + 1));
    return () => subscription.dispose();
  }, [panelApi]);

  const add = () => {
    const tab = { key: ++nextKey, number: Math.max(0, ...tabs.map((c) => c.number)) + 1, exited: false };
    setTabs([...tabs, tab]);
    setActive(tab.key);
  };

  useEffect(() => {
    if (!folder) return;
    const first = { key: ++nextKey, number: 1, exited: false };
    setTabs([first]);
    setActive(first.key);
    return () => setTabs([]);
  }, [folder]);

  /** Closing a tab kills its shell; the tab to the right (else left) takes over. */
  const close = (key: number) => {
    const index = tabs.findIndex((tab) => tab.key === key);
    const rest = tabs.filter((tab) => tab.key !== key);
    setTabs(rest);
    if (key === active) setActive((rest[index] ?? rest[index - 1])?.key ?? null);
  };

  useRegisterCommands(
    () =>
      folder
        ? [
            {
              id: "terminal.new",
              title: t("terminal.new"),
              group: "terminal",
              shortcuts: ["Mod+Shift+T"],
              scope: "workspace",
              run: () => {
                showPanel();
                add();
              },
            },
            ...(active !== null
              ? [{ id: "terminal.close", title: t("commands.closeTerminal"), group: "terminal" as const, scope: "workspace" as const, run: () => close(active) }]
              : []),
          ]
        : [],
    [t, folder, active],
  );

  if (!folder) return <>{empty}</>;

  return (
    <div className="flex h-full flex-col bg-surface-editor">
      <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border px-1">
        <div role="tablist" aria-label={t("terminal.tabs")} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.key}
              role="tab"
              aria-selected={tab.key === active}
              onClick={() => setActive(tab.key)}
              onAuxClick={(e) => e.button === 1 && close(tab.key)}
              className={cn(
                "group flex shrink-0 cursor-pointer items-center gap-1 rounded-[4px] py-0.5 pr-0.5 pl-2 text-[11px] select-none",
                tab.key === active ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:text-text-primary",
                tab.exited && "text-text-muted",
              )}
            >
              <SquareTerminal className="size-3 shrink-0" aria-hidden />
              {t(tab.exited ? "terminal.nameExited" : "terminal.name", { number: tab.number })}
              <button
                type="button"
                aria-label={t("terminal.close", { number: tab.number })}
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.key);
                }}
                className="flex size-4 items-center justify-center rounded-[3px] text-text-muted opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-surface hover:text-text-primary"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label={t("terminal.new")} title={t("terminal.new")} onClick={add}>
          <Plus />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.key}
            backend={backend}
            active={tab.key === active}
            focusRequest={focusRequest}
            theme={theme}
            mode={resolvedMode}
            fontSize={settings.editor.fontSize}
            onExit={() => setTabs((current) => current.map((c) => (c.key === tab.key ? { ...c, exited: true } : c)))}
          />
        ))}
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <Button size="sm" variant="outline" onClick={add}>
              <Plus /> {t("terminal.new")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
