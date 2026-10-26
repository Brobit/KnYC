import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  analysisPaths,
  graphSchema,
  learningPath,
  MemoryHost,
  pathIdFor,
  pathPaths,
  scanSchema,
  type Job,
  type LearningPath,
  type StageContext,
  type StageDefinition,
  type Summaries,
} from "@knyc/core";
import { defaultSettings } from "@knyc/core/schemas";
import { AnalysisScreen } from "@/analysis/AnalysisScreen";
import { BrowserDownload } from "@/analysis/BrowserDownload";
import type { BrowserBackend } from "@/analysis/browser-backend";
import { ChoosePathScreen } from "@/analysis/ChoosePathScreen";
import { OverviewScreen } from "@/analysis/OverviewScreen";
import { createFakeImportBackend } from "@/import/import-backend";
import { JobManager } from "@/jobs/job-manager";
import { JobsProvider } from "@/jobs/jobs-context";
import { SettingsProvider } from "@/lib/settings";

const INPUT = { source: "/home/you/code/express-notes", sourceHash: "blake3:0123456789abcdef", name: "express-notes", workspace: "/home/you/KnYC/express-notes" };

/** A three-step path, as the plan stage would save it. */
function samplePath(job: Job): LearningPath {
  const step = (n: number, title: string, unit: string) => ({
    id: `s0${n}`,
    index: n - 1,
    title,
    goal: "g",
    introduces: [{ unit, kind: "file" as const, change: "add" as const }],
    estimatedMinutes: 25,
  });
  return learningPath.parse({
    schemaVersion: 1,
    id: pathIdFor(job.choice!),
    trackId: job.choice!.track,
    size: job.choice!.size,
    setupAsStep: job.choice!.setupAsStep,
    generatedWith: { planning: { providerId: "claude-cli", model: "sonnet" }, at: "2026-10-23T08:00:00.000Z" },
    status: "preparing",
    milestones: [{ id: "m1", title: "Notes API", summary: "s", stepIds: ["s01", "s02", "s03"] }],
    steps: [step(1, "Configuration", "src/config.ts"), step(2, "Note store", "src/notes/notes.store.ts"), step(3, "Routes", "src/notes/notes.routes.ts")],
  });
}

/**
 * A manager whose stages save the sample project's results at once. `hold` keeps the summaries
 * stage waiting (at 3/8) until released, to look at the screen mid-analysis; `holdStep2` keeps the
 * checks of step 2 waiting the same way.
 */
function manager(host = new MemoryHost(), hold = false, holdStep2 = false) {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let releaseStep2: () => void = () => {};
  const step2 = new Promise<void>((resolve) => (releaseStep2 = resolve));
  const backend = createFakeImportBackend();
  const jobs = new JobManager({
    host,
    dataDir: async () => "/data",
    roles: () => defaultSettings().roles,
    provider: () => {
      throw new Error("no AI here");
    },
    newId: () => "job-1",
    stages: (job): StageDefinition[] => {
      const paths = analysisPaths(job.cacheDir);
      const sample = backend.quickScan(job.input.source);
      const steps: Record<string, (context: StageContext) => Promise<void>> = {
        intake: async () => {},
        scan: async () => host.writeFile(paths.scan, JSON.stringify((await sample).scan)),
        graph: async () => host.writeFile(paths.graph, JSON.stringify((await sample).graph)),
        summaries: async (context) => {
          context.progress(3, 8);
          context.aiCall();
          // Held like a long AI call, which a cancel kills.
          if (hold) await Promise.race([held, new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve()))]);
          if (context.signal.aborted) return;
          const summaries: Summaries = {
            version: 1,
            files: [{ path: "src/app.ts", role: "app factory", summary: "s", keySymbols: [] }],
            modules: [],
            project: { name: "express-notes", purpose: "A small notes API kept in memory.", architecture: "Routes call a store.", entryPoints: [], keyConcepts: [] },
          };
          await host.writeFile(paths.summaries, JSON.stringify(summaries));
        },
        plan: async () => host.writeFile(pathPaths(job.cacheDir, pathIdFor(job.choice!)).path, JSON.stringify(samplePath(job))),
        timeline: async () => {},
        checks: async (context) => {
          const file = pathPaths(job.cacheDir, pathIdFor(job.choice!)).path;
          let path = learningPath.parse(JSON.parse(await host.readFile(file)));
          for (const [i, step] of path.steps.entries()) {
            context.progress(i, 3);
            if (holdStep2 && i === 1) await step2;
            path = { ...path, steps: path.steps.map((s) => (s.id === step.id ? { ...s, prep: "checks-ready" as const } : s)) };
            await host.writeFile(file, JSON.stringify(path));
          }
          context.progress(3, 3);
          await host.writeFile(file, JSON.stringify({ ...path, status: "ready" }));
        },
      };
      return job.stages.map(({ id }) => ({ id, run: (context) => steps[id]!(context) }));
    },
  });
  return { jobs, release, releaseStep2 };
}

function renderWith(jobs: JobManager, ui: React.ReactNode) {
  render(
    <SettingsProvider initial={defaultSettings()}>
      <JobsProvider manager={jobs}>{ui}</JobsProvider>
    </SettingsProvider>,
  );
}

describe("the browser sample", () => {
  it("is what knyc-sys would return (the schemas accept it)", async () => {
    const { scan, graph } = await createFakeImportBackend().quickScan("/x/express-notes");
    expect(() => scanSchema.parse(scan)).not.toThrow();
    expect(() => graphSchema.parse(graph)).not.toThrow();
  });
});

describe("AnalysisScreen", () => {
  it("shows each stage live, what was found so far, and the overview once done", async () => {
    const { jobs, release } = manager(new MemoryHost(), true);
    const user = userEvent.setup();
    let opened: Job | null = null;
    const job = await jobs.startAnalysis(INPUT);
    renderWith(jobs, <AnalysisScreen jobId={job.id} onHome={() => {}} onOverview={(j) => (opened = j)} onChoosePath={() => {}} onStartLearning={async () => {}} />);

    expect(screen.getByRole("heading", { name: "Analyzing express-notes" })).toBeInTheDocument();
    const stages = screen.getByRole("list", { name: "Stages" });
    await waitFor(() => expect(within(stages).getByRole("listitem", { name: "Summaries" })).toHaveTextContent("Summarizing files: 3/8"));
    expect(within(stages).getByRole("listitem", { name: "Summaries" })).toHaveAttribute("aria-current", "step");
    expect(within(stages).getByRole("listitem", { name: "Static scan" })).toHaveTextContent("TypeScript · Express 4.21.2 · Vitest");
    expect(within(stages).getByRole("listitem", { name: "Code graph" })).toHaveTextContent("9 files · 9 symbols");
    expect(within(stages).getByRole("listitem", { name: "Curriculum plan" })).toHaveTextContent("After you choose a path");
    expect(screen.getByText("1 AI call so far")).toBeInTheDocument();
    expect(screen.getByText(/minutes? left/)).toBeInTheDocument();

    const found = screen.getByRole("complementary");
    expect(await within(found).findByRole("button", { name: /Backend/ })).toBeInTheDocument();
    expect(within(found).getByRole("button", { name: /Full project/ })).toBeInTheDocument();
    expect(within(found).getByText("No frontend found: this project is an API only.")).toBeInTheDocument();

    release();
    await user.click(await screen.findByRole("button", { name: /See the overview/ }));
    expect(screen.getByRole("heading", { name: "express-notes is analyzed" })).toBeInTheDocument();
    expect(opened).not.toBeNull();
  });

  it("cancels and resumes from this screen", async () => {
    const { jobs } = manager(new MemoryHost(), true);
    const job = await jobs.startAnalysis(INPUT);
    const user = userEvent.setup();
    renderWith(jobs, <AnalysisScreen jobId={job.id} onHome={() => {}} onOverview={() => {}} onChoosePath={() => {}} onStartLearning={async () => {}} />);
    await user.click(await screen.findByRole("button", { name: /Cancel analysis/ }));
    expect(await screen.findByText("Cancelled. Resume to go on where it stopped.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resume/ })).toBeInTheDocument();
  });

  it("says when the analysis no longer exists", () => {
    const { jobs } = manager();
    renderWith(jobs, <AnalysisScreen jobId="gone" onHome={() => {}} onOverview={() => {}} onChoosePath={() => {}} onStartLearning={async () => {}} />);
    expect(screen.getByText("This analysis no longer exists.")).toBeInTheDocument();
  });
});

describe("OverviewScreen", () => {
  it("shows the stack, the summary, the architecture map and the tracks", async () => {
    const { jobs } = manager();
    const job = await jobs.startAnalysis(INPUT);
    await jobs.whenSettled(job.id);
    const user = userEvent.setup();
    const chosen: string[] = [];
    renderWith(jobs, <OverviewScreen jobId={job.id} onHome={() => {}} onChoosePath={(_job, track) => chosen.push(track)} />);

    expect(await screen.findByRole("heading", { name: "express-notes", level: 1 })).toBeInTheDocument();
    const stack = screen.getByLabelText("Stack");
    for (const chip of ["TypeScript", "Express 4.21.2", "Vitest"]) expect(within(stack).getByText(chip)).toBeInTheDocument();
    expect(screen.getByText(/A small notes API kept in memory\. Routes call a store\./)).toBeInTheDocument();

    const map = screen.getByRole("img", { name: "Architecture map with 8 boxes" });
    expect(within(map).getByText("app.ts")).toBeInTheDocument();
    expect(within(map).getByText("app factory")).toBeInTheDocument();
    expect(map.querySelectorAll("path")).toHaveLength(8);

    const backend = screen.getByRole("button", { name: /Backend/ });
    await user.click(backend);
    expect(backend).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /Choose a path/ }));
    expect(chosen).toEqual(["backend"]);
  });
});

describe("ChoosePathScreen", () => {
  it("chooses the track, the size and the setup step, then goes on with the same job", async () => {
    const { jobs } = manager();
    const job = await jobs.startAnalysis(INPUT);
    await jobs.whenSettled(job.id);
    const user = userEvent.setup();
    let started: Job | null = null;
    renderWith(jobs, <ChoosePathScreen jobId={job.id} track="backend" onBack={() => {}} onStarted={(j) => (started = j)} />);

    expect(await screen.findByRole("heading", { name: "Choose your path" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Backend/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: /Standard/ })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: /Full project/ }));
    await user.click(screen.getByRole("radio", { name: /Deep dive/ }));
    await user.click(screen.getByRole("switch", { name: /Teach project setup/ }));

    const summary = screen.getByRole("complementary");
    expect(within(summary).getByText("Deep dive")).toBeInTheDocument();
    expect(within(summary).getByText("Taught as step 1")).toBeInTheDocument();
    expect(within(summary).getByText("Your tests + generated")).toBeInTheDocument();

    await user.click(within(summary).getByRole("button", { name: /Generate my path/ }));
    await waitFor(() => expect(started).not.toBeNull());
    expect(started!.choice).toEqual({ track: "full", size: "deep", setupAsStep: true });
    expect(started!.stages.map((s) => s.id).slice(4)).toEqual(["plan", "timeline", "checks"]);
    expect((await jobs.whenSettled(job.id))?.status).toBe("done");
  });

  it("doesn't offer Chromium for a project without a frontend (#89)", async () => {
    const { jobs } = manager();
    const job = await jobs.startAnalysis(INPUT);
    await jobs.whenSettled(job.id);
    const user = userEvent.setup();
    const asked: string[] = [];
    const browser: BrowserBackend = { status: async () => (asked.push("status"), { installed: false }), size: async () => ({ bytes: 1 }), install: async () => ({ installed: true }) };
    renderWith(jobs, <ChoosePathScreen jobId={job.id} track="backend" onBack={() => {}} onStarted={() => {}} browser={browser} />);

    expect(await screen.findByRole("heading", { name: "Choose your path" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Full project/ }));
    expect(screen.queryByRole("group", { name: "Frontend checks in a real browser" })).not.toBeInTheDocument();
    expect(asked).toEqual([]);
  });
});

describe("BrowserDownload", () => {
  it("shows Chromium's size and downloads it only when asked, again after a failure (#89)", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    let attempts = 0;
    const browser: BrowserBackend = {
      status: async () => (calls.push("status"), { installed: false }),
      size: async () => (calls.push("size"), { bytes: 112_400_000 }),
      install: async () => {
        calls.push("install");
        return ++attempts === 1 ? { installed: false, error: "no network" } : { installed: true };
      },
    };
    render(<BrowserDownload backend={browser} />);

    const card = await screen.findByRole("group", { name: "Frontend checks in a real browser" });
    await waitFor(() => expect(card).toHaveTextContent("downloaded once into KnYC's own folder (about 112 MB)"));
    expect(calls).toEqual(["status", "size"]);

    await user.click(within(card).getByRole("button", { name: /Download Chromium/ }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("no network");
    await user.click(within(card).getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(card).toHaveTextContent("Chromium is ready"));
    expect(calls).toEqual(["status", "size", "install", "install"]);
  });
});

describe("AnalysisScreen with a path", () => {
  it("opens step 1 while the next steps are prepared, then shows them ready on their own", async () => {
    const { jobs, releaseStep2 } = manager(new MemoryHost(), false, true);
    const job = await jobs.startAnalysis(INPUT);
    await jobs.whenSettled(job.id);
    await jobs.choosePath(job.id, { track: "backend", size: "standard", setupAsStep: false });
    renderWith(jobs, <AnalysisScreen jobId={job.id} onHome={() => {}} onOverview={() => {}} onChoosePath={() => {}} onStartLearning={async () => {}} />);

    expect(screen.getByRole("heading", { name: "Preparing your path for express-notes" })).toBeInTheDocument();
    const stages = screen.getByRole("list", { name: "Stages" });
    await waitFor(() => expect(within(stages).getByRole("listitem", { name: "Checks" })).toHaveTextContent("1/3 steps ready"));
    expect(within(stages).getByRole("listitem", { name: "Curriculum plan" })).toHaveTextContent("3 steps in 1 milestone");
    const path = screen.getByRole("complementary");
    expect(await within(path).findByRole("listitem", { name: "Configuration: Ready" })).toBeInTheDocument();
    expect(within(path).getByRole("listitem", { name: "Note store: Preparing…" })).toBeInTheDocument();
    expect(within(path).getByRole("listitem", { name: "Routes: Waiting" })).toBeInTheDocument();
    expect(within(path).getByRole("button", { name: /Start step 1/ })).toBeInTheDocument();

    releaseStep2();
    expect(await screen.findByRole("heading", { name: "Your path for express-notes is ready" })).toBeInTheDocument();
    expect(await within(path).findByText("3/3 steps ready")).toBeInTheDocument();
    expect(within(path).getByRole("listitem", { name: "Routes: Ready" })).toBeInTheDocument();
  });
});
