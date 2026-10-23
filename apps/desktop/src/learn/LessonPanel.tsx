// The lesson panel (design/04 §7, knyc.pen "Lesson panel", #62): the current step, its goal and
// concepts, the lesson (written the first time the step opens), and its checks with one Run
// (Ctrl/⌘+Enter), then the help ladder (#63): hints 1 → 2 → 3, then reveal the original, each rung
// counted; "Explain this failure" on a failing check and the step chat (#64), kept with the step.
import { ArrowUp, CircleCheck, LoaderCircle, Play, RotateCcw, Sparkles, Target } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { nextHintLevel, type CheckRun } from "@knyc/core";
import { formatShortcut, useRegisterCommands } from "@/commands/commands";
import { Chip } from "@/components/knyc/badges";
import { CheckRow, HintLadder, type CheckState } from "@/components/knyc/checks";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLearning, type Reveal } from "./learning-context";
import { Markdown } from "./Markdown";
import { RevealDialog } from "./RevealDialog";

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
  const { learning, stepId, checks, results, running, lesson, stepProgress, hint, help, runChecks, retryLesson, takeHint, reveal, explain, ask } = useLearning();
  const [question, setQuestion] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);
  const send = () => {
    if (!question.trim() || help.busy) return;
    const asked = question;
    setQuestion("");
    void ask(asked).then(() => chatEnd.current?.scrollIntoView?.({ block: "nearest" }));
  };
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [revealed, setRevealed] = useState<Reveal | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const hintsUsed = stepProgress?.hintsUsed.length ?? 0;
  const next = nextHintLevel(stepProgress);

  const openReveal = async () => {
    setRevealError(null);
    try {
      setRevealed(await reveal());
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : String(error));
    }
  };

  useRegisterCommands(
    () => [
      { id: "learn.runChecks", title: t("lesson.runChecks"), group: "run" as const, shortcuts: ["Mod+Enter"], scope: "workspace" as const, run: () => void runChecks() },
      ...(next ? [{ id: "learn.nextHint", title: t("lesson.nextHint", { level: next }), group: "run" as const, scope: "workspace" as const, run: () => void takeHint(next) }] : []),
      { id: "learn.reveal", title: t("lesson.reveal"), group: "run" as const, scope: "workspace" as const, run: () => setConfirmReveal(true) },
    ],
    [t, runChecks, takeHint, next],
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
    <div className="flex h-full flex-col bg-surface">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
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
                      <div className="mx-2 mb-1 flex flex-col gap-1">
                        <details>
                          <summary className="cursor-pointer text-[11px] text-text-muted">{t(`lesson.why.${result.status}`)}</summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-text-secondary">
                            {result.failures[0]?.message || result.output || t("lesson.noOutput")}
                          </pre>
                        </details>
                        <button
                          type="button"
                          className="flex items-center gap-1 self-start text-[11px] font-medium text-accent hover:underline disabled:opacity-60"
                          disabled={help.busy !== null || lesson.status !== "ready"}
                          onClick={() => void explain(check.id).then(() => chatEnd.current?.scrollIntoView?.({ block: "nearest" }))}
                        >
                          {help.busy === check.id ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : <Sparkles className="size-3" aria-hidden />}
                          {t(help.busy === check.id ? "lesson.explaining" : "lesson.explain")}
                        </button>
                      </div>
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

        <Section title={t("lesson.stuck")}>
          <HintLadder used={hintsUsed} onHint={(level) => void takeHint(level)} onReveal={() => setConfirmReveal(true)} />
          {hint.writing && (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              {t("lesson.writingHint", { level: hint.writing })}
            </p>
          )}
          {(hint.error || revealError) && (
            <p role="alert" className="text-xs text-danger">
              {hint.error ? t("lesson.hintFailed", { reason: hint.error }) : t("lesson.revealFailed", { reason: revealError })}
            </p>
          )}
          {lesson.status === "ready" && lesson.lesson.hints.length > 0 && (
            <ol className="flex flex-col gap-2" aria-label={t("lesson.hints")}>
              {lesson.lesson.hints.map((h) => (
                <li key={h.level} className="flex flex-col gap-1 rounded-md border border-border bg-surface-2/50 px-3 py-2" aria-label={t("lesson.hint", { level: h.level })}>
                  <span className="text-[11px] font-semibold text-accent">{t("lesson.hint", { level: h.level })}</span>
                  <Markdown text={h.text} />
                </li>
              ))}
            </ol>
          )}
          {stepProgress?.revealed && (
            <button type="button" className="self-start text-xs text-text-muted underline-offset-2 hover:underline" onClick={() => void openReveal()}>
              {t("lesson.revealedAgain")}
            </button>
          )}
        </Section>

        {lesson.status === "ready" && (lesson.lesson.chat.length > 0 || help.busy || help.error) && (
          <Section title={t("lesson.chat")}>
            <ol className="flex flex-col gap-2" aria-label={t("lesson.chat")}>
              {lesson.lesson.chat.map((message, i) => (
                <li
                  key={i}
                  className={cn("rounded-md px-3 py-2", message.role === "user" ? "ml-6 bg-accent-soft text-[13px] text-text-primary" : "mr-2 border border-border")}
                  aria-label={t(message.role === "user" ? "lesson.you" : "lesson.teacher")}
                >
                  {message.role === "user" ? <p className="whitespace-pre-wrap">{message.content}</p> : <Markdown text={message.content} />}
                </li>
              ))}
            </ol>
            {help.busy && (
              <p className="flex items-center gap-2 text-xs text-text-muted">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                {t("lesson.thinking")}
              </p>
            )}
            {help.error && (
              <p role="alert" className="text-xs text-danger">
                {t("lesson.helpFailed", { reason: help.error })}
              </p>
            )}
            <div ref={chatEnd} />
          </Section>
        )}
      </div>

      {lesson.status === "ready" && (
        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter goes to the next line.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={t("lesson.askPlaceholder")}
            aria-label={t("lesson.ask")}
            className="max-h-32 min-h-[34px] flex-1 resize-none rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <Button type="submit" size="icon" aria-label={t("lesson.send")} disabled={!question.trim() || help.busy !== null}>
            <ArrowUp />
          </Button>
        </form>
      )}

      <AlertDialog open={confirmReveal} onOpenChange={setConfirmReveal}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("lesson.revealTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t(hintsUsed < 3 ? "lesson.revealBodyHints" : "lesson.revealBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("lesson.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void openReveal()}>{t("lesson.revealConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RevealDialog reveal={revealed} onClose={() => setRevealed(null)} />
    </div>
  );
}
