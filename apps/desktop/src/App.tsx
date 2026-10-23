import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Job, TrackId } from "@knyc/core";
import { CommandPalette } from "@/commands/CommandPalette";
import { CommandsProvider, formatShortcut, useCommands, useRegisterCommands } from "@/commands/commands";
import { AppBar } from "@/components/knyc/app-bar";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { MODES, THEMES, ThemeRoot, useTheme } from "@/lib/theme";
import { DesignSystem } from "@/screens/DesignSystem";
import { AnalysisScreen } from "@/analysis/AnalysisScreen";
import { ChoosePathScreen } from "@/analysis/ChoosePathScreen";
import { OverviewScreen } from "@/analysis/OverviewScreen";
import { ImportScreen } from "@/import/ImportScreen";
import { Home } from "@/screens/Home";
import { Onboarding } from "@/screens/Onboarding";
import { useAiStatus } from "@/settings/ai-status";
import { SettingsScreen } from "@/settings/SettingsScreen";
import { Workspace } from "@/workspace/Workspace";
import { useWorkspace, WorkspaceProvider } from "@/workspace/workspace-context";

type Screen = "onboarding" | "home" | "import" | "analysis" | "overview" | "choosePath" | "workspace" | "designSystem" | "settings";

const crumbKey: Record<Screen, string> = {
  onboarding: "onboarding.welcome.title",
  home: "home.title",
  import: "import.title",
  analysis: "analysis.crumb",
  overview: "overview.crumb",
  choosePath: "choose.crumb",
  workspace: "workspace.title",
  designSystem: "designSystem.title",
  settings: "settings.title",
};

// The app opens on onboarding the first time (#58), on Home after that; other screens are reached
// from Home, the palette and the settings button.
function App() {
  const { settings } = useSettings();
  const [screen, setScreen] = useState<Screen>(() => (settings.onboardedAt ? "home" : "onboarding"));
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
  const aiStatus = useAiStatus();
  // Where the settings button goes back to.
  const back = useRef<Screen>("home");
  if (screen !== "settings") back.current = screen;
  // The analysis the analysis / overview / choose path screens show.
  const [jobId, setJobId] = useState<string | null>(null);
  const [chosenTrack, setChosenTrack] = useState<TrackId | null>(null);
  const openAnalysis = (job: Job) => {
    setJobId(job.id);
    // A finished analysis without a path opens on the overview; with one, on its preparation.
    setScreen(job.status === "done" && !job.choice ? "overview" : "analysis");
  };
  const choosePath = (job: Job, track: TrackId | null) => {
    setJobId(job.id);
    setChosenTrack(track);
    setScreen("choosePath");
  };

  useEffect(() => {
    if (i18n.language !== settings.uiLanguage) void i18n.changeLanguage(settings.uiLanguage);
  }, [i18n, settings.uiLanguage]);

  useRegisterCommands(
    () => [
      { id: "file.openFolder", title: t("commands.openFolder"), group: "file", shortcuts: ["Mod+O"], run: () => void pickFolder().then((picked) => picked && setScreen("workspace")) },
      { id: "app.home", title: t("commands.showHome"), group: "app", run: () => setScreen("home") },
      { id: "app.import", title: t("commands.importProject"), group: "app", run: () => setScreen("import") },
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

  if (screen === "onboarding") {
    return (
      <div className="h-full overflow-auto bg-bg">
        <ThemeRoot />
        <Onboarding onDone={() => setScreen("home")} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <ThemeRoot />
      <CommandPalette />
      <AppBar
        crumb={t(crumbKey[screen])}
        aiStatus={aiStatus}
        onAiStatus={() => setScreen("settings")}
        actions={actions}
        onSettings={() => setScreen(screen === "settings" ? back.current : "settings")}
        onHome={() => setScreen("home")}
      />
      {/* The workspace stays mounted behind other screens so its terminals and runs keep going.
          It lays out its own panels (dockview keeps hidden ones mounted, which must not scroll the page). */}
      <main className={screen === "workspace" ? "min-h-0 flex-1 overflow-clip" : "hidden"}>
        <Workspace />
      </main>
      {screen === "home" && (
        <main className="min-h-0 flex-1 overflow-auto">
          <Home onOpened={() => setScreen("workspace")} onImport={() => setScreen("import")} onOpenAnalysis={openAnalysis} />
        </main>
      )}
      {screen === "import" && (
        <main className="min-h-0 flex-1 overflow-auto">
          <ImportScreen onCancel={() => setScreen("home")} onStarted={openAnalysis} />
        </main>
      )}
      {screen === "analysis" && jobId && (
        <main className="min-h-0 flex-1 overflow-auto">
          <AnalysisScreen
            jobId={jobId}
            onHome={() => setScreen("home")}
            onOverview={(job) => {
              setJobId(job.id);
              setScreen("overview");
            }}
            onChoosePath={(job) => choosePath(job, job.choice?.track ?? null)}
          />
        </main>
      )}
      {screen === "overview" && jobId && (
        <main className="min-h-0 flex-1 overflow-auto">
          <OverviewScreen jobId={jobId} onHome={() => setScreen("home")} onChoosePath={choosePath} />
        </main>
      )}
      {screen === "choosePath" && jobId && (
        <main className="min-h-0 flex-1 overflow-auto">
          <ChoosePathScreen jobId={jobId} track={chosenTrack} onBack={() => setScreen("overview")} onStarted={openAnalysis} />
        </main>
      )}
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
