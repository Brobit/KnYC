// Keeps the analyses going whatever the screen (#57). It lives as long as the app: at start it
// reads the job registry, goes on with jobs the app was closed in the middle of, and schedules
// paused ones for when the usage limit resets. Screens read its snapshot and get updates live.
import {
  JobRegistry,
  jobStages,
  loadAnalysisSoFar,
  loadPathSoFar,
  newAnalysisJob,
  runJob,
  type AiProvider,
  type AnalysisInput,
  type AnalysisResult,
  type Host,
  type Job,
  type LearningPath,
  type PathChoice,
  type Settings,
  type StageDefinition,
  withPathChoice,
} from "@knyc/core";

/** What a job saved so far: the analysis results, and the path once one is chosen. */
export type JobResults = Partial<AnalysisResult> & { path?: LearningPath };

export interface JobManagerDependencies {
  host: Host;
  /** The KnYC data folder (`<app data>`); sandboxes, caches and the job registry go there. */
  dataDir: () => Promise<string>;
  /** settings.roles when a job (re)starts, so a model changed in Settings applies next time. */
  roles: () => Settings["roles"];
  /** The AI provider for one run; aborting `signal` must stop its calls. */
  provider: (signal: AbortSignal) => AiProvider;
  /** For tests: other stages than the analysis and path ones. */
  stages?: (job: Job, signal: AbortSignal) => StageDefinition[];
  now?: () => Date;
  newId?: () => string;
}

type Listener = () => void;

/** Jobs that need nothing from the learner to go on. */
const unfinished = (job: Job) => job.status === "running" || job.status === "paused";

export class JobManager {
  private readonly deps: JobManagerDependencies;
  private registry: JobRegistry | null = null;
  private jobs = new Map<string, Job>();
  private snapshot: Job[] = [];
  private readonly running = new Map<string, { controller: AbortController; done: Promise<Job> }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<Listener>();
  private ready: Promise<void> | null = null;

  constructor(deps: JobManagerDependencies) {
    this.deps = deps;
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Every known job, oldest first. */
  getSnapshot = () => this.snapshot;

  /** Loads the registry and picks up where the app stopped. Safe to call more than once. */
  init(): Promise<void> {
    this.ready ??= (async () => {
      this.registry = new JobRegistry(this.deps.host, await this.deps.dataDir());
      for (const job of await this.registry.list()) this.set(job);
      for (const job of this.snapshot) {
        if (job.status === "running") this.start(job);
        else if (job.status === "paused") this.schedule(job);
      }
    })();
    return this.ready;
  }

  /** Registers and starts an analysis of `input.source`. */
  async startAnalysis(input: AnalysisInput): Promise<Job> {
    await this.init();
    const job = newAnalysisJob(input, {
      id: this.deps.newId?.() ?? `analysis-${Date.now().toString(36)}`,
      dataDir: await this.deps.dataDir(),
      now: this.now(),
    });
    await this.registry!.add(job);
    this.set(job);
    this.start(job);
    return job;
  }

  /**
   * Goes on with the path the learner chose (#61): plan, timeline, then checks step by step. A
   * running job is stopped first; choosing another path starts the path stages over.
   */
  async choosePath(id: string, choice: PathChoice): Promise<Job> {
    await this.cancel(id);
    const job = this.jobs.get(id);
    if (!job) throw new Error(`no analysis ${id}`);
    if (job.stages.some((s) => s.id === "summaries" && s.status !== "done")) throw new Error("the analysis isn't finished");
    const chosen = withPathChoice(job, choice);
    await this.save(chosen);
    this.start(chosen);
    return chosen;
  }

  /** Starts a paused, failed or cancelled job again from its first unfinished stage. */
  resume(id: string): void {
    const job = this.jobs.get(id);
    if (job && !this.running.has(id) && job.status !== "done") this.start(job);
  }

  /** Stops the job: its AI calls are killed, the stage in progress starts over on resume. */
  async cancel(id: string): Promise<void> {
    this.clearTimer(id);
    const run = this.running.get(id);
    if (run) {
      run.controller.abort();
      await run.done;
      return;
    }
    const job = this.jobs.get(id);
    if (job && unfinished(job)) await this.save({ ...job, status: "cancelled", resumeAt: undefined, reason: undefined });
  }

  /** Cancels the job if needed and forgets it (its cached results stay). */
  async remove(id: string): Promise<void> {
    await this.cancel(id);
    await this.registry?.remove(id);
    this.jobs.delete(id);
    this.publish();
  }

  /** What the job's finished stages saved (scan, graph, summaries, the path), for the analysis screens. */
  async results(job: Job): Promise<JobResults> {
    const [analysis, path] = await Promise.all([loadAnalysisSoFar(this.deps.host, job.cacheDir), loadPathSoFar(this.deps.host, job)]);
    return { ...analysis, path };
  }

  /** The run in progress, for tests and for waiting on a job. */
  whenSettled(id: string): Promise<Job | undefined> {
    return this.running.get(id)?.done ?? Promise.resolve(this.jobs.get(id));
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  private start(job: Job) {
    this.clearTimer(job.id);
    const controller = new AbortController();
    const signal = controller.signal;
    const stages =
      this.deps.stages?.(job, signal) ?? jobStages(job, { host: this.deps.host, provider: this.deps.provider, roles: this.deps.roles() });
    const done = runJob(job, {
      host: this.deps.host,
      statePath: this.registry!.statePath(job.id),
      stages,
      signal,
      now: () => this.now(),
      onEvent: (event) => this.set(event.job),
    })
      .catch(async (error: unknown) => {
        // The runner itself failed (the state couldn't be saved): report it on the job.
        const failed: Job = { ...(this.jobs.get(job.id) ?? job), status: "failed", reason: String(error) };
        this.set(failed);
        return failed;
      })
      .then((final) => {
        this.running.delete(job.id);
        if (final.status === "paused") this.schedule(final);
        return final;
      });
    this.running.set(job.id, { controller, done });
  }

  /** Paused on a usage limit: try again when it resets. */
  private schedule(job: Job) {
    this.clearTimer(job.id);
    const at = job.resumeAt ? Date.parse(job.resumeAt) : this.now().getTime();
    const delay = Math.max(0, at - this.now().getTime());
    this.timers.set(
      job.id,
      setTimeout(() => {
        this.timers.delete(job.id);
        const latest = this.jobs.get(job.id);
        if (latest?.status === "paused") this.start(latest);
      }, delay),
    );
  }

  private clearTimer(id: string) {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }

  private async save(job: Job) {
    const saved = { ...job, updatedAt: this.now().toISOString() };
    await this.deps.host.writeFile(this.registry!.statePath(job.id), JSON.stringify(saved, null, 2));
    this.set(saved);
  }

  private set(job: Job) {
    this.jobs.set(job.id, job);
    this.publish();
  }

  private publish() {
    this.snapshot = [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const listener of this.listeners) listener();
  }
}
