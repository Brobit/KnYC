// The path map (design/04 §7b, #65): milestones and steps with their status, where the learner
// is, and a jump to a later step after a warning (decision F3: the steps in between are skipped and
// the original's code applied). The architecture view of the map comes later.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { stepStates, type LearningPath } from "@knyc/core";
import { PathProgress, StepItem } from "@/components/knyc/progress";
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
import { useLearning } from "./learning-context";

type Step = LearningPath["steps"][number];

export function PathPanel({ empty }: { empty: ReactNode }) {
  const { t } = useTranslation();
  const { learning, stepId, skipTo, moving } = useLearning();
  const [jumpTo, setJumpTo] = useState<Step | null>(null);
  if (!learning) return <>{empty}</>;

  const { path } = learning;
  const progress = learning.progress.paths[path.id];
  const states = stepStates(path, progress);
  const current = path.steps.findIndex((s) => s.id === stepId);
  const count = (state: string) => [...states.values()].filter((s) => s === state).length;
  const steps = new Map(path.steps.map((s) => [s.id, s]));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-surface p-4">
      <header className="flex flex-col gap-2">
        <PathProgress total={path.steps.length} current={current + 1} />
        <p className="text-xs text-text-muted">
          {progress?.completedAt ? t("pathMap.complete") : t("pathMap.summary", { passed: count("passed"), skipped: count("skipped") })}
        </p>
      </header>
      {moving.error && (
        <p role="alert" className="text-xs text-danger">
          {t("pathMap.jumpFailed", { reason: moving.error })}
        </p>
      )}
      {path.milestones.map((milestone, m) => (
        <section key={milestone.id} className="flex flex-col gap-0.5" aria-label={milestone.title}>
          <h3 className="mb-1 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">{t("pathMap.milestone", { number: m + 1, title: milestone.title })}</h3>
          <ol className="flex flex-col gap-0.5">
            {milestone.stepIds.map((id) => {
              const step = steps.get(id)!;
              const state = states.get(id)!;
              const details = progress?.steps[id];
              const label = t(`pathMap.state.${state}`);
              const later = state === "locked" && path.steps.indexOf(step) > current;
              return (
                <li key={id} aria-label={`${step.title}: ${label}`} title={details?.snapshot ? t("pathMap.snapshot", { id: details.snapshot.slice(0, 7) }) : label}>
                  {later ? (
                    <button type="button" className="w-full rounded-[4px] text-left hover:bg-surface-2" onClick={() => setJumpTo(step)} disabled={moving.busy}>
                      <StepItem state={state} title={step.title} id={id} />
                    </button>
                  ) : (
                    <StepItem state={state} title={step.title} id={id} />
                  )}
                  {(details?.hintsUsed.length || details?.revealed) && (
                    <p className="pl-9 text-[11px] text-text-muted">
                      {[details.hintsUsed.length ? t("pathMap.hints", { count: details.hintsUsed.length }) : null, details.revealed ? t("pathMap.revealed") : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <AlertDialog open={jumpTo !== null} onOpenChange={(open) => !open && setJumpTo(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pathMap.jumpTitle", { step: (jumpTo?.index ?? 0) + 1, title: jumpTo?.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t("pathMap.jumpBody", { count: jumpTo ? path.steps.indexOf(jumpTo) - current : 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("lesson.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => jumpTo && void skipTo(jumpTo.id)}>{t("pathMap.jump")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
