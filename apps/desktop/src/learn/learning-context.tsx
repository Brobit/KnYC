// The learning state of the open workspace (#62): which path and step the learner is on (from
// `.knyc/`), the step's checks and their last results, its lesson, and the help ladder (#63).
// While the job still prepares later steps (design/02 D5), their checks are copied into `.knyc/`
// as they become ready.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  appendRuns,
  knycPaths,
  latestRuns,
  learningPath,
  lesson as lessonSchema,
  pathIdFor,
  project as projectSchema,
  PROJECT_FILE,
  readProgress,
  runStepChecks,
  startWorkspace,
  storedTestFiles,
  syncPreparedSteps,
  withCheckAttempt,
  withHint,
  withHintUsed,
  withReveal,
  workspaceStepChecks,
  writeProgress,
  type Check,
  type CheckRun,
  type Job,
  type LearningPath,
  type Lesson,
  type FileChange,
  type HintLevel,
  type LearnerFiles,
  type Progress,
  type StepProgress,
  type Project,
} from "@knyc/core";
import { useOptionalJobs } from "@/jobs/jobs-context";
import { useWorkspace } from "@/workspace/workspace-context";
import { checkRunFor, workspaceFiles, type RunCheckCommand } from "./learn-backend";

/** What Reveal original shows: the original's change for the step, and the learner's files. */
export interface Reveal {
  changes: FileChange[];
  mine: LearnerFiles;
}

export type LessonState = { status: "loading" } | { status: "ready"; lesson: Lesson } | { status: "error"; message: string } | { status: "unavailable" };

interface Learning {
  project: Project;
  path: LearningPath;
  progress: Progress;
}

interface LearningContext {
  /** Null when the open folder isn't a KnYC workspace (or none is open). */
  learning: Learning | null;
  /** The job that prepares this path, while the app knows it. */
  job: Job | undefined;
  stepId: string | null;
  /** The current step's checks; empty while the step is still being prepared. */
  checks: Check[];
  /** The latest result of each check. */
  results: Map<string, CheckRun>;
  /** Checks waiting for their result in the current run. */
  running: Set<string>;
  lesson: LessonState;
  /** The current step in progress.json: attempts, hints used, revealed. */
  stepProgress: StepProgress | undefined;
  /** The hint being written, and why the last one couldn't be. */
  hint: { writing: HintLevel | null; error: string | null };
  runChecks: () => Promise<void>;
  retryLesson: () => void;
  /** Writes hint `level` (the next rung) into the lesson and counts it. */
  takeHint: (level: HintLevel) => Promise<void>;
  /** Counts the reveal and returns the original's changes for the step, with the learner's version. */
  reveal: () => Promise<Reveal>;
  /** Creates the workspace of the job's path, on R₀, and opens it. */
  startLearning: (job: Job) => Promise<void>;
}

const Context = createContext<LearningContext | null>(null);

export function LearningProvider({ children, runCheck }: { children: ReactNode; runCheck?: RunCheckCommand }) {
  const { fs, folder, createFolder } = useWorkspace();
  const jobs = useOptionalJobs();
  const files = useMemo(() => workspaceFiles(fs), [fs]);
  const run = useMemo(() => runCheck ?? checkRunFor(fs), [runCheck, fs]);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [results, setResults] = useState<Map<string, CheckRun>>(new Map());
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [lesson, setLesson] = useState<LessonState>({ status: "unavailable" });
  // Bumped to read `.knyc/` again (a new workspace was just written, a step was copied in).
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const job = learning && jobs?.jobs.find((j) => j.input.sourceHash === learning.project.source.hash && j.choice && pathIdFor(j.choice) === learning.path.id);
  const stepId = learning?.progress.paths[learning.path.id]?.currentStepId ?? null;

  // The workspace's documents.
  useEffect(() => {
    let live = true;
    void (async () => {
      if (!folder || !(await files.exists(PROJECT_FILE))) return null;
      const project = projectSchema.parse(JSON.parse(await files.read(PROJECT_FILE)));
      const progress = await readProgress(files);
      const pathId = progress?.activePathId;
      if (!progress || !pathId) return null;
      const path = learningPath.parse(JSON.parse(await files.read(knycPaths(pathId).path)));
      return { project, path, progress };
    })()
      .catch((error: unknown) => {
        console.error("could not read the workspace's .knyc folder", error);
        return null;
      })
      .then((loaded) => live && setLearning(loaded));
    return () => {
      live = false;
    };
  }, [folder, files, version]);

  // The current step's checks and their last results.
  useEffect(() => {
    if (!learning || !stepId) return;
    let live = true;
    void Promise.all([workspaceStepChecks(files, learning.path, stepId), latestRuns(files, learning.path.id, stepId)]).then(([stepChecks, latest]) => {
      if (!live) return;
      setChecks(stepChecks);
      setResults(latest);
    });
    return () => {
      live = false;
    };
  }, [learning, stepId, files]);

  // Steps the job prepared since: copied into `.knyc/` as they become ready.
  const prepared = job?.stages.find((s) => s.id === "checks")?.progress?.done;
  const syncing = useRef(false);
  useEffect(() => {
    if (!jobs || !job || !learning || syncing.current) return;
    syncing.current = true;
    void jobs
      .results(job)
      .then(async ({ path }) => {
        if (!path) return;
        const added = await syncPreparedSteps(
          files,
          path,
          (id) => jobs.stepChecks(job, id),
          () => jobs.testFiles(job),
        );
        const changed = path.steps.some((s, i) => s.prep !== learning.path.steps[i]?.prep);
        if (added.length > 0 || changed) reload();
      })
      .catch((error: unknown) => console.error("could not copy the prepared steps", error))
      .finally(() => (syncing.current = false));
  }, [jobs, job?.id, job?.status, prepared, learning, files, reload]);

  // The lesson: read when it was written before, else generated once (design/02 D3).
  const [lessonAttempt, setLessonAttempt] = useState(0);
  const lessonFor = useRef<string | null>(null);
  useEffect(() => {
    if (!learning || !stepId) return setLesson({ status: "unavailable" });
    const file = knycPaths(learning.path.id).lesson(stepId);
    // The job can show up after the workspace (the app starting): that is worth another look.
    const key = `${learning.path.id}/${stepId}/${lessonAttempt}/${job ? "job" : "none"}`;
    if (lessonFor.current === key) return;
    lessonFor.current = key;
    let live = true;
    void (async (): Promise<LessonState> => {
      if (await files.exists(file)) return { status: "ready", lesson: lessonSchema.parse(JSON.parse(await files.read(file))) };
      if (!jobs || !job) return { status: "unavailable" };
      setLesson({ status: "loading" });
      const written = await jobs.lesson(job, stepId);
      await files.write(file, `${JSON.stringify(written, null, 2)}\n`);
      return { status: "ready", lesson: written };
    })()
      .catch((error: unknown): LessonState => ({ status: "error", message: error instanceof Error ? error.message : String(error) }))
      .then((state) => {
        if (live) setLesson(state);
        else lessonFor.current = null;
      });
    return () => {
      live = false;
    };
  }, [learning, stepId, job?.id, jobs, files, lessonAttempt]);

  const runChecks = useCallback(async () => {
    if (!learning || !stepId || checks.length === 0 || running.size > 0) return;
    const { path, project } = learning;
    setRunning(new Set(checks.map((c) => c.id)));
    try {
      const runs = await runStepChecks({
        checks,
        pathId: path.id,
        files,
        run,
        commands: project.commands[0],
        testFiles: await storedTestFiles(files, path.id),
        onResult: (result) => {
          setResults((current) => new Map(current).set(result.checkId, result));
          setRunning((current) => {
            const next = new Set(current);
            next.delete(result.checkId);
            return next;
          });
        },
      });
      await appendRuns(files, path.id, stepId, runs);
      const progress = (await readProgress(files)) ?? learning.progress;
      const updated = withCheckAttempt(progress, path.id, stepId, runs.every((r) => r.status === "pass"), new Date());
      await writeProgress(files, updated);
      setLearning((current) => current && { ...current, progress: updated });
    } finally {
      setRunning(new Set());
    }
  }, [learning, stepId, checks, running.size, files, run]);

  const stepProgress = learning && stepId ? learning.progress.paths[learning.path.id]?.steps[stepId] : undefined;
  const saveProgress = useCallback(
    async (change: (progress: Progress) => Progress) => {
      if (!learning) return;
      const updated = change((await readProgress(files)) ?? learning.progress);
      await writeProgress(files, updated);
      setLearning((current) => current && { ...current, progress: updated });
    },
    [learning, files],
  );

  /** The step's files as the learner has them (null: not written yet). */
  const learnerFiles = useCallback(
    async (paths: string[]): Promise<LearnerFiles> => {
      const mine: LearnerFiles = new Map();
      for (const path of paths) mine.set(path, (await files.exists(path)) ? await files.read(path).catch(() => null) : null);
      return mine;
    },
    [files],
  );

  const [hint, setHint] = useState<{ writing: HintLevel | null; error: string | null }>({ writing: null, error: null });
  const takeHint = useCallback(
    async (level: HintLevel) => {
      if (!learning || !stepId || !jobs || !job || lesson.status !== "ready" || hint.writing) return;
      setHint({ writing: level, error: null });
      try {
        const changes = await jobs.stepChanges(job, stepId);
        const failures = checks
          .map((c) => ({ check: c, run: results.get(c.id) }))
          .filter(({ run }) => run && run.status !== "pass")
          .map(({ check, run }) => `${check.label}: ${(run!.failures[0]?.message ?? run!.output).slice(0, 600)}`);
        const text = await jobs.hint(job, stepId, { level, earlier: lesson.lesson.hints, learnerFiles: await learnerFiles(changes.map((c) => c.path)), failures });
        const updated = withHint(lesson.lesson, level, text, new Date());
        await files.write(knycPaths(learning.path.id).lesson(stepId), `${JSON.stringify(updated, null, 2)}\n`);
        setLesson({ status: "ready", lesson: updated });
        await saveProgress((progress) => withHintUsed(progress, learning.path.id, stepId, level));
        setHint({ writing: null, error: null });
      } catch (error) {
        setHint({ writing: null, error: error instanceof Error ? error.message : String(error) });
      }
    },
    [learning, stepId, jobs, job, lesson, hint.writing, checks, results, learnerFiles, files, saveProgress],
  );

  const reveal = useCallback(async (): Promise<Reveal> => {
    if (!learning || !stepId || !jobs || !job) throw new Error("the original is in the analysis this workspace comes from; open it from Home");
    const changes = await jobs.stepChanges(job, stepId);
    await saveProgress((progress) => withReveal(progress, learning.path.id, stepId));
    return { changes, mine: await learnerFiles(changes.map((c) => c.path)) };
  }, [learning, stepId, jobs, job, saveProgress, learnerFiles]);

  const startLearning = useCallback(
    async (started: Job) => {
      if (!jobs) throw new Error("the analysis needs the KnYC desktop app");
      const root = started.input.workspace;
      if (!root) throw new Error("this analysis has no workspace folder");
      const start = await jobs.learningStart(started);
      await createFolder(root);
      await startWorkspace(files, start);
      await syncPreparedSteps(
        files,
        start.path,
        (id) => jobs.stepChecks(started, id),
        () => jobs.testFiles(started),
      );
      reload();
    },
    [jobs, createFolder, files, reload],
  );

  const value: LearningContext = {
    learning,
    job: job ?? undefined,
    stepId,
    checks,
    results,
    running,
    lesson,
    runChecks,
    stepProgress,
    hint,
    retryLesson: () => setLessonAttempt((n) => n + 1),
    takeHint,
    reveal,
    startLearning,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLearning(): LearningContext {
  const context = useContext(Context);
  if (!context) throw new Error("useLearning must be used inside <LearningProvider>");
  return context;
}
