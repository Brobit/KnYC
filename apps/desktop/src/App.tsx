import { LayoutTemplate, Shapes, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppBar } from "@/components/knyc/app-bar";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { ThemeRoot } from "@/lib/theme";
import { DesignSystem } from "@/screens/DesignSystem";
import { SettingsScreen } from "@/settings/SettingsScreen";
import { Workspace, type WorkspaceControls } from "@/workspace/Workspace";
import { WorkspaceProvider } from "@/workspace/workspace-context";

type Screen = "workspace" | "designSystem" | "settings";

const crumbKey: Record<Screen, string> = {
  workspace: "workspace.title",
  designSystem: "designSystem.title",
  settings: "settings.title",
};

// Until Home (#38) and the command palette (#37) exist, the app bar switches screens and resets the layout.
function App() {
  const { t, i18n } = useTranslation();
  const { settings } = useSettings();
  const [screen, setScreen] = useState<Screen>("workspace");
  const [workspace, setWorkspace] = useState<WorkspaceControls | null>(null);

  useEffect(() => {
    if (i18n.language !== settings.uiLanguage) void i18n.changeLanguage(settings.uiLanguage);
  }, [i18n, settings.uiLanguage]);

  const actions = (
    <>
      {screen === "workspace" && (
        <Button variant="ghost" size="icon-sm" aria-label={t("workspace.resetLayout")} title={t("workspace.resetLayout")} onClick={() => workspace?.resetLayout()}>
          <RotateCcw />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={screen === "workspace" ? t("designSystem.title") : t("workspace.title")}
        title={screen === "workspace" ? t("designSystem.title") : t("workspace.title")}
        onClick={() => setScreen(screen === "workspace" ? "designSystem" : "workspace")}
      >
        {screen === "workspace" ? <Shapes /> : <LayoutTemplate />}
      </Button>
    </>
  );

  return (
    <WorkspaceProvider>
      <div className="flex h-full flex-col bg-bg">
        <ThemeRoot />
        <AppBar
          crumb={t(crumbKey[screen])}
          aiStatus={{ label: "Claude Code", ok: true }}
          actions={actions}
          onSettings={() => setScreen(screen === "settings" ? "workspace" : "settings")}
        />
        {/* The workspace stays mounted behind other screens so its terminals and runs keep going.
            It lays out its own panels (dockview keeps hidden ones mounted, which must not scroll the page). */}
        <main className={screen === "workspace" ? "min-h-0 flex-1 overflow-clip" : "hidden"}>
          <Workspace onReady={setWorkspace} />
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
    </WorkspaceProvider>
  );
}

export default App;
