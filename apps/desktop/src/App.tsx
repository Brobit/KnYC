import { useTranslation } from "react-i18next";
import { AppBar } from "@/components/knyc/app-bar";
import { ThemeRoot } from "@/lib/theme";
import { DesignSystem } from "@/screens/DesignSystem";

// M2 starts with the design system screen; Home (#38) and the editor layout (#30) replace it.
function App() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col bg-bg">
      <ThemeRoot />
      <AppBar crumb={t("designSystem.title")} aiStatus={{ label: "Claude Code", ok: true }} />
      <main className="min-h-0 flex-1 overflow-auto">
        <DesignSystem />
      </main>
    </div>
  );
}

export default App;
