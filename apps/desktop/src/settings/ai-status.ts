// What the app bar shows about the AI: the planning model (the one that matters most) and whether
// it can be used right now — Claude Code installed and logged in, or an API key in the keychain.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/lib/settings";
import { settingsBackend, type SettingsBackend } from "./settings-backend";

export interface AiStatus {
  label: string;
  ok: boolean;
  /** Why it can't be used, for the tooltip. */
  problem?: string;
}

export function useAiStatus(backend: SettingsBackend = settingsBackend): AiStatus {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { providerId, model } = settings.roles.planning;
  const provider = settings.providers.find((p) => p.id === providerId);
  // null while checking: shown as fine rather than flashing a warning at every launch.
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setProblem(null);
    const report = (next: string | null) => live && setProblem(next);
    if (provider?.type === "claude-cli") {
      backend.claudeCli().then(
        (s) => report(!s.path ? t("aiStatus.cliMissing") : s.loggedIn === false ? t("aiStatus.cliLoggedOut") : null),
        () => report(t("aiStatus.cliMissing")),
      );
    } else if (provider?.keyRef) {
      backend.keyHint(provider.keyRef).then(
        (hint) => report(hint ? null : t("aiStatus.noKey")),
        () => report(t("aiStatus.noKey")),
      );
    }
    return () => {
      live = false;
    };
  }, [backend, provider?.type, provider?.keyRef, t]);

  if (!provider) return { label: t("aiStatus.notSetUp"), ok: false, problem: t("aiStatus.notSetUpHint") };
  return { label: `${provider.label} · ${model}`, ok: problem === null, problem: problem ?? undefined };
}
