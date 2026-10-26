// Settings (design/04 §8, knyc.pen "Screen · Settings"). Every change is saved to settings.json at
// once; API keys go to the OS keychain instead (settings-backend.ts).
import { Code, Container, Languages, Palette, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/lib/settings";
import { MODES, THEMES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { AiSection, selectClass } from "./AiSection";
import { settingsBackend, type SettingsBackend } from "./settings-backend";

type SectionId = "ai" | "checks" | "editor" | "appearance" | "language";
const SECTIONS: { id: SectionId; icon: LucideIcon }[] = [
  { id: "ai", icon: Sparkles },
  { id: "checks", icon: Container },
  { id: "editor", icon: Code },
  { id: "appearance", icon: Palette },
  { id: "language", icon: Languages },
];

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-text-primary">
          {label}
        </label>
        {hint && <span className="text-xs text-text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const Card = ({ children }: { children: ReactNode }) => <div className="rounded-[10px] border border-border bg-surface">{children}</div>;

/** A whole number in [min, max]; saved on each valid keystroke, other input stays a draft. */
function NumberInput({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max;
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      className="h-[30px] w-20 text-[13px]"
      aria-invalid={!valid}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const next = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isInteger(next) && next >= min && next <= max) onChange(next);
      }}
      onBlur={() => !valid && setDraft(String(value))}
    />
  );
}

function EditorSection() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const set = (change: Partial<typeof settings.editor>) => update((s) => ({ ...s, editor: { ...s.editor, ...change } }));
  return (
    <Card>
      <Field label={t("settings.editor.fontSize")} hint={t("settings.editor.fontSizeHint")} htmlFor="settings-font-size">
        <NumberInput id="settings-font-size" value={settings.editor.fontSize} min={8} max={32} onChange={(fontSize) => set({ fontSize })} />
      </Field>
      <Field label={t("settings.editor.tabSize")} hint={t("settings.editor.tabSizeHint")} htmlFor="settings-tab-size">
        <NumberInput id="settings-tab-size" value={settings.editor.tabSize} min={1} max={8} onChange={(tabSize) => set({ tabSize })} />
      </Field>
    </Card>
  );
}

function Choice<T extends string>({ label, options, value, onChange, name }: { label: string; options: T[]; value: T; onChange: (value: T) => void; name: (value: T) => string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-border-strong p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          className={cn(
            "rounded-[5px] px-3 py-1 text-[12px] transition-colors",
            option === value ? "bg-accent-soft font-medium text-accent" : "text-text-secondary hover:text-text-primary",
          )}
          onClick={() => onChange(option)}
        >
          {name(option)}
        </button>
      ))}
    </div>
  );
}

/** Where checks run (#91): on this computer, or in a Docker container with the workspace mounted. */
function ChecksSection({ backend }: { backend: SettingsBackend }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const [docker, setDocker] = useState<"checking" | "running" | "stopped" | "missing">("checking");
  useEffect(() => {
    let live = true;
    backend.toolchains().then(
      (list) => {
        const found = list.find((tc) => tc.id === "docker");
        if (live) setDocker(!found?.version ? "missing" : found.running === false ? "stopped" : "running");
      },
      () => live && setDocker("missing"),
    );
    return () => {
      live = false;
    };
  }, [backend]);
  const mode = settings.runChecksIn;
  return (
    <Card>
      <Field label={t("settings.checks.where")} hint={t(mode === "docker" ? "settings.checks.dockerHint" : "settings.checks.localHint")}>
        <Choice
          label={t("settings.checks.where")}
          options={["local", "docker"] as const as ("local" | "docker")[]}
          value={mode}
          onChange={(runChecksIn) => update((s) => ({ ...s, runChecksIn }))}
          name={(v) => t(`settings.checks.modes.${v}`)}
        />
      </Field>
      <Field label={t("settings.checks.docker")} hint={mode === "docker" && docker !== "running" && docker !== "checking" ? t("settings.checks.dockerNeeded") : undefined}>
        <span className={cn("text-xs", docker === "running" ? "text-success" : docker === "checking" ? "text-text-muted" : "text-warning")}>{t(`settings.checks.status.${docker}`)}</span>
      </Field>
    </Card>
  );
}

function AppearanceSection() {
  const { t } = useTranslation();
  const { name, mode, setName, setMode } = useTheme();
  return (
    <Card>
      <Field label={t("theme.label")}>
        <Choice label={t("theme.label")} options={THEMES} value={name} onChange={setName} name={(v) => t(`theme.${v}`)} />
      </Field>
      <Field label={t("theme.mode")}>
        <Choice label={t("theme.mode")} options={MODES} value={mode} onChange={setMode} name={(v) => t(`theme.${v}`)} />
      </Field>
    </Card>
  );
}

function LanguageSection() {
  const { t, i18n } = useTranslation();
  const { settings, update } = useSettings();
  const languages = Object.keys(i18n.options.resources ?? { en: {} });
  return (
    <Card>
      <Field label={t("settings.language.label")} hint={t("settings.language.hint")} htmlFor="settings-language">
        <select
          id="settings-language"
          className={cn(selectClass, "w-48")}
          value={settings.uiLanguage}
          onChange={(e) => update((s) => ({ ...s, uiLanguage: e.target.value }))}
        >
          {languages.map((code) => (
            <option key={code} value={code}>
              {t(`settings.language.names.${code}`, { defaultValue: code })}
            </option>
          ))}
        </select>
      </Field>
    </Card>
  );
}

export function SettingsScreen({ backend = settingsBackend }: { backend?: SettingsBackend }) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>("ai");

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-60 shrink-0 flex-col gap-0.5 border-r border-border bg-surface-2 p-3" aria-label={t("settings.title")}>
        {SECTIONS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors [&_svg]:size-3.5",
              section === id ? "bg-accent-soft font-medium text-accent" : "text-text-secondary hover:bg-surface hover:text-text-primary",
            )}
            onClick={() => setSection(id)}
          >
            <Icon aria-hidden />
            {t(`settings.sections.${id}`)}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-14 py-9">
          <header className="flex flex-col gap-1.5">
            <h1 className="text-[22px] font-semibold text-text-primary">{t(`settings.sections.${section}`)}</h1>
            <p className="text-[13px] text-text-secondary">{t(`settings.intro.${section}`)}</p>
          </header>
          {section === "ai" && <AiSection backend={backend} />}
          {section === "checks" && <ChecksSection backend={backend} />}
          {section === "editor" && <EditorSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "language" && <LanguageSection />}
        </div>
      </div>
    </div>
  );
}
