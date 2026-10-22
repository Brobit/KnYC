import { invoke } from "@tauri-apps/api/core";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { defaultSettings, loadDocument, type Settings } from "@knyc/core/schemas";

/** True inside the desktop app; false in a plain browser (`pnpm dev`), where localStorage stands in. */
export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const BROWSER_KEY = "knyc.settings";

/** Reads settings.json; first launch or an unreadable file gives the defaults (never a crash). */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = isTauri() ? await invoke<string | null>("settings_read") : localStorage.getItem(BROWSER_KEY);
    return raw ? loadDocument("settings", JSON.parse(raw)) : defaultSettings();
  } catch (error) {
    console.warn("settings.json is unreadable; using defaults", error);
    return defaultSettings();
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const json = JSON.stringify(settings, null, 2);
  if (isTauri()) await invoke("settings_write", { json });
  else localStorage.setItem(BROWSER_KEY, json);
}

interface SettingsContext {
  settings: Settings;
  /** Applies a change and saves it. */
  update: (change: (current: Settings) => Settings) => void;
}

const Context = createContext<SettingsContext | null>(null);

export function SettingsProvider({ children, initial }: { children: ReactNode; initial?: Settings }) {
  const [settings, setSettings] = useState<Settings | null>(initial ?? null);

  useEffect(() => {
    if (!initial) void loadSettings().then(setSettings);
  }, [initial]);

  const update = useCallback((change: (current: Settings) => Settings) => {
    setSettings((current) => {
      if (!current) return current;
      const next = change(current);
      void saveSettings(next).catch((error) => console.error("could not save settings", error));
      return next;
    });
  }, []);

  // Rendering waits for settings so the first frame already has the right theme.
  if (!settings) return null;
  return <Context.Provider value={{ settings, update }}>{children}</Context.Provider>;
}

export function useSettings(): SettingsContext {
  const context = useContext(Context);
  if (!context) throw new Error("useSettings must be used inside <SettingsProvider>");
  return context;
}
