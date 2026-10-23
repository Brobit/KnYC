import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { analysisPaths, graphSchema, MemoryHost, scanSchema, type Job, type StageContext, type StageDefinition, type Summaries } from "@knyc/core";
import { defaultSettings } from "@knyc/core/schemas";
import { AnalysisScreen } from "@/analysis/AnalysisScreen";
import { OverviewScreen } from "@/analysis/OverviewScreen";
import { createFakeImportBackend } from "@/import/import-backend";
import { JobManager } from "@/jobs/job-manager";
import { JobsProvider } from "@/jobs/jobs-context";
import { SettingsProvider } from "@/lib/settings";

const INPUT = { source: "/home/you/code/express-notes", sourceHash: "blake3:0123456789abcdef", name: "express-notes", workspace: "/home/you/KnYC/express-notes" };

/**
 * A manager whose stages save the sample project's results at once. `hold` keeps the summaries
 * stage waiting (at 3/8) until released, to look at the screen mid-analysis.
 */
function manager(host = new MemoryHost(), hold = false) {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
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
      };
      return job.stages.map(({ id }) => ({ id, run: (context) => steps[id]!(context) }));
    },
  });
  return { jobs, release };
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
    renderWith(jobs, <AnalysisScreen jobId={job.id} onHome={() => {}} onOverview={(j) => (opened = j)} />);

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
    renderWith(jobs, <AnalysisScreen jobId={job.id} onHome={() => {}} onOverview={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Cancel analysis/ }));
    expect(await screen.findByText("Cancelled. Resume to go on where it stopped.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resume/ })).toBeInTheDocument();
  });

  it("says when the analysis no longer exists", () => {
    const { jobs } = manager();
    renderWith(jobs, <AnalysisScreen jobId="gone" onHome={() => {}} onOverview={() => {}} />);
    expect(screen.getByText("This analysis no longer exists.")).toBeInTheDocument();
  });
});

describe("OverviewScreen", () => {
  it("shows the stack, the summary, the architecture map and the tracks", async () => {
    const { jobs } = manager();
    const job = await jobs.startAnalysis(INPUT);
    await jobs.whenSettled(job.id);
    const user = userEvent.setup();
    renderWith(jobs, <OverviewScreen jobId={job.id} onHome={() => {}} />);

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
    expect(screen.getByRole("button", { name: /Choose a path/ })).toBeDisabled();
  });
});
