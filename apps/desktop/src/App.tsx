import { LayoutTemplate, Shapes, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppBar } from "@/components/knyc/app-bar";
import { Button } from "@/components/ui/button";
import { ThemeRoot } from "@/lib/theme";
import { DesignSystem } from "@/screens/DesignSystem";
import { Workspace, type WorkspaceControls } from "@/workspace/Workspace";
import { WorkspaceProvider } from "@/workspace/workspace-context";

type Screen = "workspace" | "designSystem";

// Until Home (#38) and the command palette (#37) exist, the app bar switches screens and resets the layout.
function App() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>("workspace");
  const [workspace, setWorkspace] = useState<WorkspaceControls | null>(null);

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
          crumb={screen === "workspace" ? t("workspace.title") : t("designSystem.title")}
          aiStatus={{ label: "Claude Code", ok: true }}
          actions={actions}
        />
        <main className="min-h-0 flex-1 overflow-auto">
          {screen === "workspace" ? <Workspace onReady={setWorkspace} /> : <DesignSystem />}
        </main>
      </div>
    </WorkspaceProvider>
  );
}

export default App;
