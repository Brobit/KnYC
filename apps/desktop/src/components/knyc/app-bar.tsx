// The app bar shown on every screen except the learning workspace (design/07, knyc.pen "App bar").
import { ChevronRight, Palette, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MODES, THEMES, useTheme, type ThemeMode, type ThemeName } from "@/lib/theme";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-[6px] bg-accent font-bold text-on-accent"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      aria-hidden
    >
      K
    </span>
  );
}

export function ThemeMenu() {
  const { t } = useTranslation();
  const { name, mode, setName, setMode } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("theme.label")}>
          <Palette />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={name} onValueChange={(v) => setName(v as ThemeName)}>
          {THEMES.map((theme) => (
            <DropdownMenuRadioItem key={theme} value={theme}>
              {t(`theme.${theme}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("theme.mode")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
          {MODES.map((m) => (
            <DropdownMenuRadioItem key={m} value={m}>
              {t(`theme.${m}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface AppBarProps {
  crumb: string;
  /** e.g. "Claude Code · sonnet"; a warning dot and the reason when it can't be used. */
  aiStatus?: { label: string; ok: boolean; problem?: string };
  /** Clicking the AI status (to fix it in Settings). */
  onAiStatus?: () => void;
  /** Screen-specific buttons, shown before the theme and settings buttons. */
  actions?: ReactNode;
  onSettings?: () => void;
  /** The logo and name lead Home. */
  onHome?: () => void;
}

export function AppBar({ crumb, aiStatus, onAiStatus, actions, onSettings, onHome }: AppBarProps) {
  const { t } = useTranslation();
  return (
    <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border bg-surface-2 px-4">
      <button type="button" onClick={onHome} disabled={!onHome} aria-label={t("home.title")} className="-mx-1 flex items-center gap-2.5 rounded-md px-1 py-0.5 enabled:hover:bg-surface">
        <Logo />
        <span className="text-[13px] font-semibold text-text-primary">{t("app.name")}</span>
      </button>
      <ChevronRight className="size-3.5 text-text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">{crumb}</span>
      {aiStatus && (
        <button
          type="button"
          onClick={onAiStatus}
          disabled={!onAiStatus}
          title={aiStatus.problem ?? t("aiStatus.ready")}
          aria-label={t("aiStatus.label", { label: aiStatus.label, state: aiStatus.problem ?? t("aiStatus.ready") })}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text-secondary enabled:hover:text-text-primary"
        >
          <span className={aiStatus.ok ? "size-[7px] rounded-full bg-success" : "size-[7px] rounded-full bg-warning"} aria-hidden />
          {aiStatus.label}
        </button>
      )}
      {actions}
      <ThemeMenu />
      <Button variant="ghost" size="icon-sm" aria-label={t("settings.title")} onClick={onSettings}>
        <Settings />
      </Button>
    </header>
  );
}
