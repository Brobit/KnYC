import { useEffect, useState } from "react";
import type { Settings } from "@knyc/core/schemas";
import { useSettings } from "./settings";

export type ThemeName = Settings["theme"]["name"];
export type ThemeMode = Settings["theme"]["mode"];
export const THEMES: ThemeName[] = ["focus", "sage-camel"];
export const MODES: ThemeMode[] = ["system", "light", "dark"];

const prefersDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

/** "system" resolved against the OS setting, and kept up to date when the OS switches. */
function useResolvedMode(mode: ThemeMode): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(prefersDark);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

/** Applies the saved theme to <html> (tokens.css reads data-theme and data-mode). */
export function useTheme() {
  const { settings, update } = useSettings();
  const { name, mode } = settings.theme;
  const resolvedMode = useResolvedMode(mode);

  useEffect(() => {
    document.documentElement.dataset.theme = name;
    document.documentElement.dataset.mode = resolvedMode;
  }, [name, resolvedMode]);

  return {
    name,
    mode,
    resolvedMode,
    setName: (next: ThemeName) => update((s) => ({ ...s, theme: { ...s.theme, name: next } })),
    setMode: (next: ThemeMode) => update((s) => ({ ...s, theme: { ...s.theme, mode: next } })),
  };
}

/** Mounted once at the root so the theme applies before any screen asks for it. */
export function ThemeRoot() {
  useTheme();
  return null;
}
