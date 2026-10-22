import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JobRegistry, MemoryHost, newAnalysisJob, type Job, type StageDefinition } from "@knyc/core";
import { defaultSettings } from "@knyc/core/schemas";
import { createFakeImportBackend } from "@/import/import-backend";
import { folderName, ImportScreen } from "@/import/ImportScreen";
import { AnalysesList } from "@/jobs/AnalysesList";
import { JobManager } from "@/jobs/job-manager";
import { JobsProvider } from "@/jobs/jobs-context";
import { loadSettings, SettingsProvider } from "@/lib/settings";

/** A job manager whose analyses wait until cancelled (nothing runs in these tests). */
function manager(host = new MemoryHost()) {
  return new JobManager({
    host,
    dataDir: async () => "/data",
    roles: () => defaultSettings().roles,
    provider: () => {
      throw new Error("no AI here");
    },
    stages: (job, signal) =>
      job.stages.map<StageDefinition>(({ id }) => ({ id, run: () => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())) })),
    newId: () => "job-1",
  });
}

function renderImport(jobs: JobManager | null = manager()) {
  const user = userEvent.setup();
  const onStarted = vi.fn<(job: Job) => void>();
  const onCancel = vi.fn();
  render(
    <SettingsProvider initial={defaultSettings()}>
      <JobsProvider manager={jobs}>
        <ImportScreen onStarted={onStarted} onCancel={onCancel} backend={createFakeImportBackend()} />
      </JobsProvider>
    </SettingsProvider>,
  );
  return { user, onStarted, onCancel };
}

const start = () => screen.getByRole("button", { name: /Start analysis/ });

describe("ImportScreen", () => {
  it("scans the picked folder without AI and shows what will be sent, with the estimate", async () => {
    const { user } = renderImport();
    expect(start()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Browse/ }));

    expect(await screen.findByText("/home/you/code/express-notes")).toBeInTheDocument();
    expect(screen.getByText("/home/you/KnYC/express-notes")).toBeInTheDocument();
    const quickScan = screen.getByLabelText("Quick scan:");
    for (const chip of ["TypeScript", "Express 4.21.2", "Vitest", "12 files", "333 lines"]) expect(within(quickScan).getByText(chip)).toBeInTheDocument();

    const sent = screen.getByRole("region", { name: "What will be sent to your AI" });
    const tile = (label: string) => within(sent).getByText(label).parentElement;
    expect(tile("files sent")).toHaveTextContent("files sent8");
    expect(tile("files excluded")).toHaveTextContent("files excluded5");
    expect(within(sent).getByText(/^≈ \d+ min$/)).toBeInTheDocument();
    expect(within(sent).getByText(/uses part of your Claude plan/)).toBeInTheDocument();
    const excluded = within(sent).getByRole("list", { name: "Excluded" });
    expect(within(excluded).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      ".envsecret",
      "node_modules/, dist/ignored",
      "docs/diagram.pngbinary",
      "package-lock.jsonlockfile",
    ]);
    expect(start()).toBeEnabled();
  });

  it("starts the analysis as a background job, with the workspace folder", async () => {
    const host = new MemoryHost();
    const { user, onStarted } = renderImport(manager(host));
    await user.click(screen.getByRole("button", { name: /Browse/ }));
    await user.click(await screen.findByRole("button", { name: /Change/ }));
    expect(await screen.findByText("/home/you/learning/express-notes")).toBeInTheDocument();
    await user.click(start());

    await waitFor(() => expect(onStarted).toHaveBeenCalledOnce());
    expect(onStarted.mock.calls[0][0].input).toEqual({
      source: "/home/you/code/express-notes",
      sourceHash: "blake3:0123456789abcdef0123456789abcdef",
      name: "express-notes",
      workspace: "/home/you/learning/express-notes",
    });
    expect((await new JobRegistry(host, "/data").list()).map((j) => j.input.name)).toEqual(["express-notes"]);
  });

  it("keeps the estimate setting and says the analysis needs the desktop app in a browser", async () => {
    const { user, onCancel } = renderImport(null);
    expect(screen.getByText("The analysis runs in the KnYC desktop app.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Browse/ }));
    await screen.findByText("/home/you/code/express-notes");
    expect(start()).toBeDisabled();

    await user.click(screen.getByRole("switch"));
    await waitFor(async () => expect((await loadSettings()).confirmCostEstimate).toBe(false));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("names a folder like the OS does", () => {
    expect(folderName("/home/you/code/express-notes/")).toBe("express-notes");
    expect(folderName("C:\\Users\\you\\code\\shop")).toBe("shop");
  });
});

describe("AnalysesList", () => {
  it("shows each analysis with where it is, and lets the learner resume or remove it", async () => {
    const host = new MemoryHost();
    const registry = new JobRegistry(host, "/data");
    const job = newAnalysisJob({ source: "/s", sourceHash: "blake3:ab", name: "notes" }, { id: "job-1", dataDir: "/data" });
    await registry.add({ ...job, status: "cancelled" });
    const user = userEvent.setup();
    render(
      <SettingsProvider initial={defaultSettings()}>
        <JobsProvider manager={manager(host)}>
          <AnalysesList />
        </JobsProvider>
      </SettingsProvider>,
    );
    const row = await screen.findByRole("listitem", { name: "notes" });
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: /Resume/ }));
    expect(await within(row).findByText("Copying the project")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: /Cancel/ }));
    expect(await within(row).findByText("Cancelled")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Remove notes" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "notes" })).not.toBeInTheDocument());
  });

  it("shows nothing without analyses or outside the jobs provider", () => {
    const { container } = render(<AnalysesList />);
    expect(container).toBeEmptyDOMElement();
  });
});
