// The lesson panel (design/04 §7, knyc.pen "Lesson panel", #62): the current step, its goal and
// concepts, the lesson (written the first time the step opens), and its checks with one Run
// (Ctrl/⌘+Enter). Hints, reveal, "explain this failure" and the step chat come with #63 / #64.
import { CircleCheck, LoaderCircle, Play, RotateCcw, Target } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CheckRun } from "@knyc/core";
import { formatShortcut, useRegisterCommands } from "@/commands/commands";
import { Chip } from "@/components/knyc/badges";
import { CheckRow, type CheckState } from "@/components/knyc/checks";
import { Button } from "@/components/ui/button";
import { useLearning } from "./learning-context";
import { Markdown } from "./Markdown";

const seconds = (run: CheckRun) => (run.durationMs < 1000 ? `${(run.durationMs / 1000).toFixed(1)} s` : `${Math.round(run.durationMs / 100) / 10} s`);

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[13px] font-semibold text-text-primary">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function LessonPanel({ empty }: { empty: ReactNode }) {
  const { t } = useTranslation();
  const { learning, stepId, checks, results, running, lesson, runChecks, retryLesson } = useLearning();

  useRegisterCommands(
    () => [{ id: "learn.runChecks", title: t("lesson.runChecks"), group: "run" as const, shortcuts: ["Mod+Enter"], scope: "workspace" as const, run: () => void runChecks() }],
    [t, runChecks],
  );

  const step = learning?.path.steps.find((s) => s.id === stepId);
  if (!learning || !step) return <>{empty}</>;

  const milestoneIndex = learning.path.milestones.findIndex((m) => m.stepIds.includes(step.id));
  const milestone = learning.path.milestones[milestoneIndex];
  const busy = running.size > 0;
  const stateOf = (id: string): CheckState => {
    if (running.has(id)) return "running";
    const result = results.get(id);
    return !result ? "pending" : result.status === "pass" ? "pass" : "fail";
  };
  const allPass = checks.length > 0 && checks.every((c) => results.get(c.id)?.status === "pass") && !busy;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface">
      <div className="flex flex-col gap-5 p-4">
        <header className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
            {milestone
              ? t("lesson.stepOfMilestone", { step: step.index + 1, milestone: milestoneIndex + 1, title: milestone.title })
              : t("lesson.step", { step: step.index + 1 })}
          </p>
          <h2 className="text-base font-semibold text-text-primary">{step.title}</h2>
          {step.concepts.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label={t("lesson.concepts")}>
              {step.concepts.map((concept) => (
                <Chip key={concept}>{concept}</Chip>
              ))}
            </div>
          )}
        </header>

        <section className="flex flex-col gap-1.5 rounded-md border border-accent/40 bg-accent-soft px-3 py-2.5" aria-label={t("lesson.goal")}>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-accent">
            <Target className="size-3.5" aria-hidden />
            {t("lesson.goal")}
          </span>
          <p className="text-[13px] leading-relaxed text-text-primary">{step.goal}</p>
        </section>

        <Section title={t("lesson.lesson")}>
          {lesson.status === "ready" && (
            <>
              <Markdown text={lesson.lesson.explanation} />
              {lesson.lesson.architectureNote && <p className="text-xs text-text-muted">{t("lesson.whereItFits", { note: lesson.lesson.architectureNote })}</p>}
            </>
          )}
          {lesson.status === "loading" && (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              {t("lesson.writing")}
            </p>
          )}
          {lesson.status === "error" && (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-xs text-danger">
                {t("lesson.failed", { reason: lesson.message })}
              </p>
              <Button variant="outline" size="sm" onClick={retryLesson}>
                <RotateCcw />
                {t("lesson.retry")}
              </Button>
            </div>
          )}
          {lesson.status === "unavailable" && <p className="text-xs text-text-muted">{t("lesson.unavailable")}</p>}
        </Section>

        <Section
          title={t("lesson.checks")}
          actions={
            <Button size="sm" onClick={() => void runChecks()} disabled={busy || checks.length === 0} title={formatShortcut("Mod+Enter")}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Play />}
              {t("lesson.runChecks")}
            </Button>
          }
        >
          {checks.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              {t("lesson.preparing")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5" aria-label={t("lesson.checks")}>
              {checks.map((check) => {
                const result = results.get(check.id);
                const state = stateOf(check.id);
                return (
                  <li key={check.id} aria-label={`${check.label}: ${t(`lesson.state.${state}`)}`}>
                    <CheckRow state={state} label={check.label} meta={result && state !== "running" ? seconds(result) : undefined} />
                    {state === "fail" && result && (
                      <details className="mx-2 mb-1">
                        <summary className="cursor-pointer text-[11px] text-text-muted">{t(`lesson.why.${result.status}`)}</summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-text-secondary">
                          {result.failures[0]?.message || result.output || t("lesson.noOutput")}
                        </pre>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {allPass && (
            <p className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-[13px] font-medium text-success" role="status">
              <CircleCheck className="size-4" aria-hidden />
              {t("lesson.allPass")}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
