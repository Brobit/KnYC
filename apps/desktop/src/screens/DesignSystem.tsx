// A living copy of the "Components" board of design/knyc.pen, in whatever theme is active.
import { Eye, FileCode, FileJson, FolderLock, FolderOpen, KeyRound, Layers, LayoutPanelLeft, Lightbulb, ListChecks, Play, ScrollText, Server, SkipForward, Terminal, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Chip, StatusBadge, TrackBadge } from "@/components/knyc/badges";
import { CheckRow, HintLadder } from "@/components/knyc/checks";
import { PanelHeader, PanelTab, TrackCard, TreeRow } from "@/components/knyc/panels";
import { PathProgress, StepItem } from "@/components/knyc/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export function DesignSystem() {
  const { t } = useTranslation();
  const s = (key: string) => t(`designSystem.sample.${key}`);
  const [hints, setHints] = useState(1);
  const [tab, setTab] = useState("terminal");
  const [selected, setSelected] = useState("frontend");

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-8 p-9">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-semibold text-text-primary">{t("designSystem.title")}</h1>
        <p className="text-[13px] text-text-secondary">{t("designSystem.intro")}</p>
      </header>

      <Section title={t("designSystem.buttons")}>
        <Button>
          <Play />
          {t("lesson.runChecks")}
        </Button>
        <Button variant="outline">
          <Lightbulb />
          {s("nextHint")}
        </Button>
        <Button variant="ghost">
          <Eye />
          {t("lesson.reveal")}
        </Button>
      </Section>

      <Section title={t("designSystem.chips")}>
        <Chip>dependency injection</Chip>
        <Chip>JWT</Chip>
        {(["backend", "frontend", "database", "deployment"] as const).map((track) => (
          <TrackBadge key={track} track={track} label={s(track)} />
        ))}
        <StatusBadge tone="warning" icon={<TriangleAlert />}>
          {s("weakCheck")}
        </StatusBadge>
        <StatusBadge tone="neutral" icon={<SkipForward />}>
          {s("skipped")}
        </StatusBadge>
        <StatusBadge tone="accent" icon={<Eye />}>
          {s("revealed")}
        </StatusBadge>
      </Section>

      <Section title={t("designSystem.tabs")}>
        <div className="flex border-b border-border bg-surface" role="tablist">
          {[
            ["terminal", Terminal],
            ["checks", ListChecks],
            ["output", ScrollText],
          ].map(([id, icon]) => (
            <PanelTab key={id as string} icon={icon as typeof Terminal} label={s(id as string)} active={tab === id} onClick={() => setTab(id as string)} />
          ))}
        </div>
      </Section>

      <Section title={t("designSystem.inputs")}>
        <div className="relative w-[300px]">
          <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-muted" aria-hidden />
          <Input className="pl-8 font-mono text-xs" placeholder={s("keyPlaceholder")} />
        </div>
        <label className="flex items-center gap-2.5 text-[13px] text-text-primary">
          <Switch defaultChecked />
          {s("setupToggle")}
        </label>
      </Section>

      <Section title={t("designSystem.checks")}>
        <div className="flex w-[320px] flex-col gap-0.5 rounded-[10px] border border-border bg-surface p-2">
          <CheckRow state="pass" label="App builds" meta="1.2 s" />
          <CheckRow state="fail" label="GET /users without token → 401" meta="0.4 s" />
          <CheckRow state="running" label="Valid token → 200" meta="running" />
          <CheckRow state="pending" label="Expired token → 401" meta="—" />
        </div>
      </Section>

      <Section title={t("designSystem.hints")}>
        <HintLadder used={hints} onHint={(level) => setHints(level)} />
      </Section>

      <Section title={t("designSystem.progress")}>
        <PathProgress total={15} current={8} className="w-[520px]" />
      </Section>

      <Section title={t("designSystem.tree")}>
        <div className="flex w-[240px] flex-col gap-px rounded-[10px] bg-surface-2 p-1.5">
          <TreeRow icon={FolderLock} name="prisma/" state="provided" />
          <TreeRow icon={FolderOpen} name="src/" />
          <TreeRow name="app.module.ts" depth={1} />
          <TreeRow icon={FolderOpen} name="auth/" depth={1} state="touched" />
          <TreeRow name="jwt.guard.ts" depth={2} state="editing" />
          <TreeRow name="auth.module.ts" depth={2} state="touched" />
          <TreeRow icon={FileJson} name="package.json" state="provided" />
          <TreeRow icon={FileCode} name="tsconfig.json" state="provided" />
        </div>
      </Section>

      <Section title={t("designSystem.cards")}>
        <div className="w-[300px]">
          <TrackCard track="backend" name={s("backend")} icon={Server} description={s("backendDescription")} meta={["2.1k lines", "38 files", "~6 h standard"]} selected={selected === "backend"} onSelect={() => setSelected("backend")} />
        </div>
        <div className="w-[300px]">
          <TrackCard track="frontend" name={s("frontend")} icon={LayoutPanelLeft} description={s("frontendDescription")} meta={["1.4k lines", "27 files", "~4 h standard"]} selected={selected === "frontend"} onSelect={() => setSelected("frontend")} />
        </div>
        <div className="flex w-[280px] flex-col gap-0.5 rounded-[10px] border border-border bg-surface p-2">
          <StepItem state="passed" title="Users service" id="s07" />
          <StepItem state="current" title="JWT guard" id="s08" />
          <StepItem state="skipped" title="Refresh tokens" id="s09" />
          <StepItem state="locked" title="Roles & permissions" id="s10" />
        </div>
      </Section>

      <Section title={t("designSystem.panel")}>
        <div className="w-[260px]">
          <PanelHeader title={s("explorer")} actions={<Layers className="size-3.5 text-text-muted" aria-hidden />} />
        </div>
      </Section>
    </div>
  );
}
