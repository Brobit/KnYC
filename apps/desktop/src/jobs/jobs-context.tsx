// The app's JobManager, created once at the root so analyses don't depend on the screen (#57).
// In the desktop app it uses the Rust pipeline host and Claude Code; a plain browser (`pnpm dev`)
// gets a simulated analysis instead (demo-jobs.ts).
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AnalysisInput, ChatInput, ExplainInput, FileChange, HintInput, Job, Lesson, PathChoice, PreparedStepChecks, WorkspaceStart } from "@knyc/core";
import { AppClaudeProvider } from "@/lib/claude-provider";
import { TauriHost, pipelineDataDir } from "@/lib/pipeline-host";
import { isTauri, useSettings } from "@/lib/settings";
import { createDemoJobManager } from "./demo-jobs";
import { JobManager, type JobResults } from "./job-manager";

interface JobsContext {
  /** False in a plain browser: the analysis needs the desktop app. */
  available: boolean;
  jobs: Job[];
  startAnalysis: (input: AnalysisInput) => Promise<Job>;
  resume: (id: string) => void;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Goes on with the path the learner chose (plan, timeline, checks). */
  choosePath: (id: string, choice: PathChoice) => Promise<Job>;
  /** What a job's finished stages saved so far. */
  results: (job: Job) => Promise<JobResults>;
  /** For the learner's workspace (#62): what it starts from, prepared checks, tests, lessons. */
  learningStart: (job: Job) => Promise<WorkspaceStart>;
  stepChecks: (job: Job, stepId: string) => Promise<PreparedStepChecks | undefined>;
  testFiles: (job: Job) => Promise<Map<string, string>>;
  lesson: (job: Job, stepId: string) => Promise<Lesson>;
  hint: (job: Job, stepId: string, request: Pick<HintInput, "level" | "earlier" | "learnerFiles" | "failures">) => Promise<string>;
  stepChanges: (job: Job, stepId: string) => Promise<FileChange[]>;
  explain: (job: Job, stepId: string, request: Pick<ExplainInput, "check" | "failure" | "learnerFiles">) => Promise<string>;
  chat: (job: Job, stepId: string, request: Pick<ChatInput, "lesson" | "learnerFiles" | "history" | "question">) => Promise<string>;
}

const Context = createContext<JobsContext | null>(null);

export function JobsProvider({ children, manager: given }: { children: ReactNode; manager?: JobManager | null }) {
  const { settings } = useSettings();
  const roles = useRef(settings.roles);
  roles.current = settings.roles;

  const [manager] = useState<JobManager | null>(() => {
    if (given !== undefined) return given;
    // A plain browser has no pipeline: `pnpm dev` shows a simulated analysis of a sample project.
    if (!isTauri()) return import.meta.env.DEV ? createDemoJobManager() : null;
    return new JobManager({
      host: new TauriHost(),
      dataDir: pipelineDataDir,
      roles: () => roles.current,
      provider: (signal) => new AppClaudeProvider(undefined, { signal }),
      // UI checks run in the app's own Chromium, once the learner downloaded it (#89).
      ui: {},
    });
  });

  useEffect(() => {
    void manager?.init().catch((error) => console.error("could not load the analysis jobs", error));
  }, [manager]);

  const empty: Job[] = [];
  const jobs = useSyncExternalStore(manager?.subscribe ?? (() => () => {}), manager?.getSnapshot ?? (() => empty));

  const unavailable = () => Promise.reject(new Error("the analysis needs the KnYC desktop app"));
  const value: JobsContext = {
    available: manager !== null,
    jobs,
    startAnalysis: (input) => manager?.startAnalysis(input) ?? unavailable(),
    resume: (id) => manager?.resume(id),
    cancel: (id) => manager?.cancel(id) ?? Promise.resolve(),
    remove: (id) => manager?.remove(id) ?? Promise.resolve(),
    choosePath: (id, choice) => manager?.choosePath(id, choice) ?? unavailable(),
    results: (job) => manager?.results(job) ?? Promise.resolve({}),
    learningStart: (job) => manager?.learningStart(job) ?? unavailable(),
    stepChecks: (job, stepId) => manager?.stepChecks(job, stepId) ?? Promise.resolve(undefined),
    testFiles: (job) => manager?.testFiles(job) ?? Promise.resolve(new Map()),
    lesson: (job, stepId) => manager?.lesson(job, stepId) ?? unavailable(),
    hint: (job, stepId, request) => manager?.hint(job, stepId, request) ?? unavailable(),
    stepChanges: (job, stepId) => manager?.stepChanges(job, stepId) ?? unavailable(),
    explain: (job, stepId, request) => manager?.explain(job, stepId, request) ?? unavailable(),
    chat: (job, stepId, request) => manager?.chat(job, stepId, request) ?? unavailable(),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useJobs(): JobsContext {
  const context = useContext(Context);
  if (!context) throw new Error("useJobs must be used inside <JobsProvider>");
  return context;
}

/** For screens that also render without jobs (tests of Home): null outside <JobsProvider>. */
export function useOptionalJobs(): JobsContext | null {
  return useContext(Context);
}
