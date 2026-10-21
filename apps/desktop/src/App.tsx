import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";

const THEMES = ["focus", "sage-camel"] as const;
const MODES = ["dark", "light"] as const;

type Theme = (typeof THEMES)[number];
type Mode = (typeof MODES)[number];

function App() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string>();
  const [theme, setTheme] = useState<Theme>("focus");
  const [mode, setMode] = useState<Mode>("dark");

  useEffect(() => {
    // getVersion only works inside Tauri; in a plain browser (`pnpm dev`) we just skip it.
    getVersion().then(setVersion, () => setVersion(undefined));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;
  }, [theme, mode]);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 bg-bg p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl bg-accent text-2xl font-bold text-on-accent">
        K
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-semibold text-text-primary">{t("app.tagline")}</h1>
        <p className="text-sm text-text-secondary">{t("app.subtitle")}</p>
      </div>
      <p className="rounded-md bg-surface-2 px-3 py-1.5 text-xs text-text-muted">{t("app.comingSoon")}</p>

      <div className="flex items-center gap-2" role="group" aria-label={t("theme.label")}>
        {THEMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTheme(name)}
            aria-pressed={theme === name}
            className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-primary aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
          >
            {t(`theme.${name}`)}
          </button>
        ))}
        {MODES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setMode(name)}
            aria-pressed={mode === name}
            className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-primary aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
          >
            {t(`theme.${name}`)}
          </button>
        ))}
      </div>

      {version && <p className="font-mono text-xs text-text-muted">{t("app.version", { version })}</p>}
    </main>
  );
}

export default App;
