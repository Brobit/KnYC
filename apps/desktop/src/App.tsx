import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandPalette } from "@/commands/CommandPalette";
import { CommandsProvider, formatShortcut, useCommands, useRegisterCommands } from "@/commands/commands";
import { AppBar } from "@/components/knyc/app-bar";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { MODES, THEMES, ThemeRoot, useTheme } from "@/lib/theme";
import { DesignSystem } from "@/screens/DesignSystem";
import { SettingsScreen } from "@/settings/SettingsScreen";
import { Workspace } from "@/workspace/Workspace";
import { useWorkspace, WorkspaceProvider } from "@/workspace/workspace-context";

type Screen = "workspace" | "designSystem" | "settings";

const crumbKey: Record<Screen, string> = {
  workspace: "workspace.title",
  designSystem: "designSystem.title",
  settings: "settings.title",
};

// Until Home (#38) exists, screens are reached from the palette and the settings button.
function App() {
  const [screen, setScreen] = useState<Screen>("workspace");
  const showWorkspace = useCallback(() => setScreen("workspace"), []);
  return (
    <CommandsProvider workspaceVisible={screen === "workspace"} showWorkspace={showWorkspace}>
      <WorkspaceProvider>
        <Shell screen={screen} setScreen={setScreen} />
      </WorkspaceProvider>
    </CommandsProvider>
  );
}

function Shell({ screen, setScreen }: { screen: Screen; setScreen: (screen: Screen) => void }) {
  const { t, i18n } = useTranslation();
  const { settings } = useSettings();
  const { pickFolder } = useWorkspace();
  const { setName, setMode } = useTheme();
  const { registry, run } = useCommands();

  useEffect(() => {
    if (i18n.language !== settings.uiLanguage) void i18n.changeLanguage(settings.uiLanguage);
  }, [i18n, settings.uiLanguage]);

  useRegisterCommands(
    () => [
      { id: "file.openFolder", title: t("commands.openFolder"), group: "file", shortcuts: ["Mod+O"], run: () => void pickFolder().then(() => setScreen("workspace")) },
      { id: "app.settings", title: t("commands.openSettings"), group: "app", shortcuts: ["Mod+,"], run: () => setScreen("settings") },
      { id: "app.workspace", title: t("commands.showWorkspace"), group: "app", run: () => setScreen("workspace") },
      { id: "app.designSystem", title: t("commands.showDesignSystem"), group: "app", run: () => setScreen("designSystem") },
      ...THEMES.map((name) => ({ id: `view.theme.${name}`, title: t("commands.theme", { name: t(`theme.${name}`) }), group: "view" as const, run: () => setName(name) })),
      ...MODES.map((mode) => ({ id: `view.mode.${mode}`, title: t("commands.mode", { mode: t(`theme.${mode}`) }), group: "view" as const, run: () => setMode(mode) })),
    ],
    [t],
  );

  const openPalette = () => {
    const palette = registry.get("palette.open");
    if (palette) run(palette);
  };

  const actions = (
    <Button variant="ghost" className="h-7 gap-2 px-2 text-xs text-text-secondary" onClick={openPalette}>
      <Search />
      {t("commands.palette")}
      <kbd className="rounded-[4px] border border-border bg-surface px-1 font-sans text-[11px] text-text-muted">{formatShortcut("Mod+K")}</kbd>
    </Button>
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <ThemeRoot />
      <CommandPalette />
      <AppBar
        crumb={t(crumbKey[screen])}
        aiStatus={{ label: "Claude Code", ok: true }}
        actions={actions}
        onSettings={() => setScreen(screen === "settings" ? "workspace" : "settings")}
      />
      {/* The workspace stays mounted behind other screens so its terminals and runs keep going.
          It lays out its own panels (dockview keeps hidden ones mounted, which must not scroll the page). */}
      <main className={screen === "workspace" ? "min-h-0 flex-1 overflow-clip" : "hidden"}>
        <Workspace />
      </main>
      {screen === "designSystem" && (
        <main className="min-h-0 flex-1 overflow-auto">
          <DesignSystem />
        </main>
      )}
      {screen === "settings" && (
        <main className="min-h-0 flex-1 overflow-clip">
          <SettingsScreen />
        </main>
      )}
    </div>
  );
}

export default App;
