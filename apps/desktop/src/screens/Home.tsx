// Home (design/04 §2, knyc.pen "Screen · Home"), reduced to what M2 needs: open a folder or a recent
// workspace. Continue cards, toolchains and tips come with learning paths (M3).
import { ArrowRight, FolderClock, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RecentWorkspace } from "@knyc/core/schemas";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { WorkspaceFsError } from "@/lib/workspace-fs";
import { ROLES } from "@/settings/providers";
import { useWorkspace } from "@/workspace/workspace-context";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "2 hours ago", "yesterday", "now", in the interface language. */
export function timeAgo(iso: string, now: Date, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "second");
}

function YourAi() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  return (
    <section className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface p-4" aria-labelledby="home-ai">
      <h2 id="home-ai" className="text-[13px] font-semibold text-text-primary">
        {t("home.yourAi")}
      </h2>
      <dl className="flex flex-col gap-2 text-xs">
        {ROLES.map((role) => {
          const { providerId, model } = settings.roles[role];
          const provider = settings.providers.find((p) => p.id === providerId);
          return (
            <div key={role} className="flex justify-between gap-3">
              <dt className="text-text-secondary">{t(`settings.roles.${role}`)}</dt>
              <dd className={provider ? "truncate text-text-primary" : "truncate text-warning"}>{provider ? `${provider.label} · ${model}` : t("home.notSetUp")}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function RecentRow({ entry, now, onOpen, onForget, error }: { entry: RecentWorkspace; now: Date; onOpen: () => void; onForget: () => void; error?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <li className="group flex items-center border-b border-border last:border-b-0" aria-label={entry.name}>
      <button type="button" onClick={onOpen} aria-label={t("home.open", { name: entry.name })} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2" title={entry.root}>
        <FolderClock className="size-4 shrink-0 text-text-muted" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-mono text-[13px] text-text-primary">{entry.name}</span>
          <span className={error ? "truncate text-xs text-danger" : "truncate text-xs text-text-muted"}>{error ?? entry.root}</span>
        </span>
        <span className="shrink-0 text-xs text-text-muted">{timeAgo(entry.lastOpenedAt, now, i18n.language)}</span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="mr-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-[error=true]:opacity-100"
        data-error={!!error}
        aria-label={t("home.forget", { name: entry.name })}
        title={t("home.forget", { name: entry.name })}
        onClick={onForget}
      >
        <X />
      </Button>
    </li>
  );
}

export function Home({ onOpened, now = new Date() }: { onOpened: () => void; now?: Date }) {
  const { t } = useTranslation();
  const { folder, pickFolder, recent, openRecent, forgetRecent } = useWorkspace();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const open = async (root: string) => {
    try {
      await openRecent(root);
      onOpened();
    } catch (e) {
      const kind = e instanceof WorkspaceFsError ? e.kind : "io";
      setErrors((current) => ({ ...current, [root]: kind === "notFound" ? t("home.missing") : t("explorer.errors.io", { detail: e instanceof Error ? e.message : String(e) }) }));
    }
  };

  const pick = async () => {
    try {
      if (await pickFolder()) onOpened();
    } catch (e) {
      setErrors((current) => ({ ...current, "": t("explorer.errors.io", { detail: e instanceof Error ? e.message : String(e) }) }));
    }
  };

  return (
    <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 px-14 py-12 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-[28px] font-semibold text-text-primary">{recent.length > 0 ? t("home.welcomeBack") : t("home.welcome")}</h1>
          <p className="text-sm text-text-secondary">{t("home.intro")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => void pick()}>
              <FolderOpen />
              {t("home.openFolder")}
            </Button>
            {folder && (
              <Button variant="outline" onClick={onOpened}>
                {t("home.backTo", { name: folder.name })}
                <ArrowRight />
              </Button>
            )}
          </div>
          {errors[""] && <p className="text-xs text-danger">{errors[""]}</p>}
        </header>

        <section className="flex flex-col gap-3" aria-labelledby="home-recent">
          <h2 id="home-recent" className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
            {t("home.recent")}
          </h2>
          {recent.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-[13px] text-text-muted">{t("home.noRecent")}</p>
          ) : (
            <ul className="overflow-hidden rounded-[10px] border border-border bg-surface" aria-labelledby="home-recent">
              {recent.map((entry) => (
                <RecentRow
                  key={entry.root}
                  entry={entry}
                  now={now}
                  error={errors[entry.root]}
                  onOpen={() => void open(entry.root)}
                  onForget={() => forgetRecent(entry.root)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <YourAi />
      </aside>
    </div>
  );
}
