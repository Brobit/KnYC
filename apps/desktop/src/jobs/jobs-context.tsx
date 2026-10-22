// The app's JobManager, created once at the root so analyses don't depend on the screen (#57).
// In the desktop app it uses the Rust pipeline host and Claude Code; a plain browser (`pnpm dev`)
// has no pipeline, so jobs are unavailable there.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AnalysisInput, Job } from "@knyc/core";
import { AppClaudeProvider } from "@/lib/claude-provider";
import { TauriHost, pipelineDataDir } from "@/lib/pipeline-host";
import { isTauri, useSettings } from "@/lib/settings";
import { JobManager } from "./job-manager";

interface JobsContext {
  /** False in a plain browser: the analysis needs the desktop app. */
  available: boolean;
  jobs: Job[];
  startAnalysis: (input: AnalysisInput) => Promise<Job>;
  resume: (id: string) => void;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const Context = createContext<JobsContext | null>(null);

export function JobsProvider({ children, manager: given }: { children: ReactNode; manager?: JobManager | null }) {
  const { settings } = useSettings();
  const roles = useRef(settings.roles);
  roles.current = settings.roles;

  const [manager] = useState<JobManager | null>(() => {
    if (given !== undefined) return given;
    if (!isTauri()) return null;
    return new JobManager({
      host: new TauriHost(),
      dataDir: pipelineDataDir,
      roles: () => roles.current,
      provider: (signal) => new AppClaudeProvider(undefined, { signal }),
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
