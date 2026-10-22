// First launch (design 04 §1, knyc.pen "Screen · Onboarding", #58): Welcome, Connect an AI,
// Toolchains. Skippable after the first card; finishing or skipping sets settings.onboardedAt so
// it never shows again.
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CircleCheck,
  Code,
  Container,
  Cpu,
  ExternalLink,
  FlaskConical,
  FolderInput,
  GitBranch,
  KeyRound,
  Package,
  RefreshCw,
  SquareTerminal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/knyc/app-bar";
import { Button } from "@/components/ui/button";
import { aiErrorMessage } from "@/lib/ai-errors";
import { openExternal } from "@/lib/open-url";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { RoleCard } from "@/settings/AiSection";
import { ROLES } from "@/settings/providers";
import { settingsBackend, type ClaudeCliStatus, type SettingsBackend, type ToolchainStatus } from "@/settings/settings-backend";

const STEPS = ["welcome", "ai", "toolchains"] as const;
type Step = (typeof STEPS)[number];

const CLAUDE_CODE_SETUP = "https://docs.claude.com/en/docs/claude-code/setup";

export function Onboarding({ onDone, backend = settingsBackend }: { onDone: () => void; backend?: SettingsBackend }) {
  const { t } = useTranslation();
  const { update } = useSettings();
  const [index, setIndex] = useState(0);
  const step: Step = STEPS[index];
  const last = index === STEPS.length - 1;

  const finish = () => {
    update((s) => ({ ...s, onboardedAt: new Date().toISOString() }));
    onDone();
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-bg px-4 py-10">
      <div className="flex items-center gap-2.5">
        <Logo size={28} />
        <span className="text-[17px] font-semibold text-text-primary">{t("app.name")}</span>
      </div>
      <section aria-labelledby="onboarding-title" className="flex w-full max-w-[640px] flex-col gap-6 rounded-[16px] border border-border bg-surface p-9">
        <StepBars index={index} />
        <header className="flex flex-col gap-2">
          <h1 id="onboarding-title" className="text-2xl font-semibold text-text-primary">
            {t(`onboarding.${step}.title`)}
          </h1>
          <p className="text-sm leading-relaxed text-text-secondary">{t(`onboarding.${step}.body`)}</p>
        </header>

        {step === "welcome" && <LoopPicture />}
        {step === "ai" && <ConnectAi backend={backend} />}
        {step === "toolchains" && <Toolchains backend={backend} />}

        <footer className="flex items-center gap-2.5 pt-2">
          {index > 0 && (
            <Button variant="ghost" className="text-text-secondary" onClick={() => setIndex(index - 1)}>
              <ArrowLeft />
              {t("onboarding.back")}
            </Button>
          )}
          <span className="flex-1" />
          {/* Skippable after the first card only (design 04 §1). */}
          {index > 0 && !last && (
            <button type="button" className="text-xs text-text-muted hover:text-text-secondary" onClick={finish}>
              {t("onboarding.later")}
            </button>
          )}
          <Button className="h-9 px-4" onClick={last ? finish : () => setIndex(index + 1)}>
            {last ? t("onboarding.start") : t("onboarding.continue")}
            <ArrowRight />
          </Button>
        </footer>
      </section>
    </div>
  );
}

function StepBars({ index }: { index: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5" aria-hidden>
        {STEPS.map((step, i) => (
          <span key={step} className={cn("h-1 rounded-[2px]", i === index ? "w-8" : "w-5", i <= index ? "bg-accent" : "bg-border-strong")} />
        ))}
      </div>
      <span className="text-[11px] text-text-muted">{t("onboarding.stepOf", { current: index + 1, total: STEPS.length })}</span>
    </div>
  );
}

const LOOP: { id: string; icon: LucideIcon }[] = [
  { id: "import", icon: FolderInput },
  { id: "learn", icon: BookOpen },
  { id: "code", icon: Code },
  { id: "check", icon: CircleCheck },
];

/** The loop in one picture: import once, then learn → code → check, step after step. */
function LoopPicture() {
  const { t } = useTranslation();
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setLit((n) => (n % (LOOP.length - 1)) + 1), 1400);
    return () => clearInterval(timer);
  }, []);
  return (
    <figure className="flex flex-col gap-3" aria-label={t("onboarding.welcome.loopLabel")}>
      <ol className="flex items-stretch gap-1">
        {LOOP.map(({ id, icon: Icon }, i) => (
          <li key={id} className="flex flex-1 items-center gap-1">
            <div
              className={cn(
                "flex flex-1 flex-col items-center gap-1.5 rounded-[10px] border px-2 py-3 text-center transition-colors duration-500",
                i === lit ? "border-accent bg-accent-soft" : "border-border bg-surface",
              )}
            >
              <Icon className={cn("size-[18px]", i === lit ? "text-accent" : "text-text-secondary")} aria-hidden />
              <span className="text-xs font-semibold text-text-primary">{t(`onboarding.welcome.loop.${id}`)}</span>
              <span className="text-[11px] leading-snug text-text-muted">{t(`onboarding.welcome.loop.${id}Hint`)}</span>
            </div>
            {i < LOOP.length - 1 && <ArrowRight className="size-3.5 shrink-0 text-text-muted" aria-hidden />}
          </li>
        ))}
      </ol>
      <figcaption className="flex items-center justify-end gap-1.5 text-[11px] text-text-muted">
        <RefreshCw className="size-3" aria-hidden />
        {t("onboarding.welcome.loopCaption")}
      </figcaption>
    </figure>
  );
}

function Option({ icon: Icon, title, detail, selected, later }: { icon: LucideIcon; title: string; detail: string; selected?: boolean; later?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      aria-current={selected || undefined}
      className={cn("flex flex-1 flex-col gap-1.5 rounded-[10px] border p-3.5", selected ? "border-accent bg-accent-soft" : "border-border bg-surface", later && "opacity-60")}
    >
      <div className="flex items-center justify-between">
        <Icon className={cn("size-[18px]", selected ? "text-accent" : "text-text-secondary")} aria-hidden />
        {later && <span className="rounded-full border border-border px-1.5 text-[10px] text-text-muted">{t("onboarding.later2")}</span>}
      </div>
      <span className="text-[13px] font-semibold text-text-primary">{title}</span>
      <span className="text-[11px] text-text-muted">{detail}</span>
    </div>
  );
}

function ConnectAi({ backend }: { backend: SettingsBackend }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [status, setStatus] = useState<ClaudeCliStatus | null>(null);
  const [check, setCheck] = useState(0);
  const [test, setTest] = useState<{ state: "running" } | { state: "ok"; seconds: string } | { state: "failed"; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    setStatus(null);
    backend.claudeCli().then(
      (s) => live && setStatus(s),
      () => live && setStatus({ path: null, version: null, loggedIn: null }),
    );
    return () => {
      live = false;
    };
  }, [backend, check]);

  const model = settings.roles.summaries.providerId === "claude-cli" ? settings.roles.summaries.model : "haiku";
  const runTest = async () => {
    setTest({ state: "running" });
    try {
      setTest({ state: "ok", seconds: ((await backend.testClaude(model)) / 1000).toFixed(1) });
    } catch (error) {
      setTest({ state: "failed", message: aiErrorMessage(t, error) });
    }
  };

  let message: ReactNode;
  if (!status) message = <p className="text-xs text-text-muted">{t("settings.ai.cliChecking")}</p>;
  else if (!status.path)
    message = (
      <Problem text={t("onboarding.ai.missing")}>
        <Button variant="outline" onClick={() => openExternal(CLAUDE_CODE_SETUP)}>
          <ExternalLink />
          {t("onboarding.ai.install")}
        </Button>
      </Problem>
    );
  else if (status.loggedIn === false) message = <Problem text={t("onboarding.ai.loggedOut", { version: status.version ?? "?" })} />;
  else
    message = (
      <p className="flex items-center gap-1.5 text-xs text-success">
        <CircleCheck className="size-3.5" aria-hidden />
        {t("onboarding.ai.ready", { version: status.version ?? "?" })}
      </p>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2.5">
        <Option icon={KeyRound} title={t("onboarding.ai.apiKey")} detail={t("onboarding.ai.apiKeyDetail")} later />
        <Option icon={SquareTerminal} title={t("onboarding.ai.cli")} detail={t("onboarding.ai.cliDetail")} selected />
        <Option icon={Cpu} title="Ollama" detail={t("onboarding.ai.ollamaDetail")} later />
      </div>

      <div className="flex flex-col gap-2 rounded-[10px] border border-border p-3.5" role="status" aria-label="Claude Code">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[13px] font-semibold text-text-primary">Claude Code</span>
          <Button variant="ghost" onClick={() => setCheck((n) => n + 1)}>
            <RefreshCw />
            {t("settings.ai.checkAgain")}
          </Button>
          <Button variant="outline" disabled={!status?.path || test?.state === "running"} onClick={() => void runTest()}>
            <FlaskConical />
            {test?.state === "running" ? t("settings.ai.testing") : t("settings.ai.test")}
          </Button>
        </div>
        {message}
        {test && test.state !== "running" && (
          <p className={cn("text-xs", test.state === "ok" ? "text-success" : "text-danger")}>
            {test.state === "ok" ? t("settings.ai.testOk", { model, seconds: test.seconds }) : test.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold text-text-primary">{t("onboarding.ai.models")}</h2>
        <p className="text-xs text-text-muted">{t("onboarding.ai.modelsHint")}</p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {ROLES.map((role) => (
            <RoleCard key={role} role={role} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Problem({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="flex items-start gap-1.5 text-xs text-warning">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        {text}
      </p>
      {children}
    </div>
  );
}

const TOOLCHAINS: { id: ToolchainStatus["id"]; name: string; icon: LucideIcon; url: string; later?: boolean }[] = [
  { id: "node", name: "Node.js", icon: Package, url: "https://nodejs.org/en/download" },
  { id: "npm", name: "npm", icon: Package, url: "https://nodejs.org/en/download" },
  { id: "git", name: "Git", icon: GitBranch, url: "https://git-scm.com/downloads" },
  { id: "docker", name: "Docker", icon: Container, url: "https://docs.docker.com/get-started/get-docker/", later: true },
  { id: "python", name: "Python", icon: Code, url: "https://www.python.org/downloads/", later: true },
  { id: "go", name: "Go", icon: Code, url: "https://go.dev/dl/", later: true },
  { id: "dotnet", name: ".NET", icon: Code, url: "https://dotnet.microsoft.com/download", later: true },
];

function Toolchains({ backend }: { backend: SettingsBackend }) {
  const { t } = useTranslation();
  const [found, setFound] = useState<Map<string, string | null> | null>(null);
  const [check, setCheck] = useState(0);

  useEffect(() => {
    let live = true;
    setFound(null);
    backend.toolchains().then(
      (list) => live && setFound(new Map(list.map((tc) => [tc.id, tc.version]))),
      () => live && setFound(new Map()),
    );
    return () => {
      live = false;
    };
  }, [backend, check]);

  const row = ({ id, name, icon: Icon, url, later }: (typeof TOOLCHAINS)[number]) => {
    const version = found?.get(id) ?? null;
    return (
      <li key={id} aria-label={name} className={cn("flex h-11 items-center gap-3 px-3.5", later && "opacity-70")}>
        <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden />
        <span className="flex-1 text-[13px] text-text-primary">{name}</span>
        {!found ? (
          <span className="text-xs text-text-muted">{t("onboarding.toolchains.checking")}</span>
        ) : version ? (
          <span className="flex items-center gap-1.5 font-mono text-xs text-success">
            <CircleCheck className="size-3.5" aria-hidden />
            {version}
          </span>
        ) : (
          <>
            <span className={cn("text-xs", later ? "text-text-muted" : "text-warning")}>{t("onboarding.toolchains.notFound")}</span>
            <Button variant="ghost" onClick={() => openExternal(url)} aria-label={t("onboarding.toolchains.installNamed", { name })}>
              <ExternalLink />
              {t("onboarding.toolchains.install")}
            </Button>
          </>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-border rounded-[10px] border border-border" aria-label={t("onboarding.toolchains.needed")}>
        {TOOLCHAINS.filter((tc) => !tc.later).map(row)}
      </ul>
      <h2 className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">{t("onboarding.toolchains.laterTitle")}</h2>
      <ul className="divide-y divide-border rounded-[10px] border border-border" aria-label={t("onboarding.toolchains.laterTitle")}>
        {TOOLCHAINS.filter((tc) => tc.later).map(row)}
      </ul>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-text-muted">{t("onboarding.toolchains.notBlocking")}</p>
        <Button variant="ghost" onClick={() => setCheck((n) => n + 1)}>
          <RefreshCw />
          {t("settings.ai.checkAgain")}
        </Button>
      </div>
    </div>
  );
}
