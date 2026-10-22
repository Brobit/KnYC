import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@knyc/core/schemas";
import { createFakeWorkspaceFs } from "@/lib/fake-workspace-fs";
import { SettingsProvider } from "@/lib/settings";
import { createFakeRunBackend, type RunBackend } from "@/run/run-backend";
import { useWorkspace, WorkspaceProvider } from "@/workspace/workspace-context";

// xterm.js needs a canvas: the stub shows the run's output as text and follows it like the real view.
vi.mock("@/run/OutputView", async () => {
  const { useEffect, useReducer } = await import("react");
  type Output = { chunks: string[]; subscribe: (listener: () => void) => () => void };
  return {
    OutputView: ({ output }: { output: Output | null }) => {
      const [, rerender] = useReducer((n: number) => n + 1, 0);
      useEffect(() => output?.subscribe(rerender), [output]);
      return <pre data-testid="output">{output?.chunks.join("")}</pre>;
    },
  };
});
const { formatDuration, RunOutput, RunPanel } = await import("@/run/RunPanel");

function OpenFolder() {
  const { pickFolder, folder } = useWorkspace();
  return folder ? null : <button onClick={() => void pickFolder()}>pick</button>;
}

async function renderPanel(backend: RunBackend = createFakeRunBackend(20)) {
  const fs = createFakeWorkspaceFs({ "package.json": "{}" });
  const user = userEvent.setup();
  render(
    <SettingsProvider initial={defaultSettings()}>
      <WorkspaceProvider fs={fs}>
        <OpenFolder />
        <RunPanel empty={<p>no folder</p>} backend={backend} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
  expect(screen.getByText("no folder")).toBeInTheDocument();
  await user.click(screen.getByText("pick"));
  await screen.findByRole("listitem", { name: "Test" });
  return { fs, user };
}

describe("RunPanel", () => {
  it("lists the scan's commands, then the other scripts", async () => {
    await renderPanel();
    const rows = within(screen.getByRole("list", { name: "Commands" })).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Install dependencies", "Test", "Start the app", "lint"]);
  });

  it("runs a command and shows its output and result", async () => {
    const { user } = await renderPanel();
    await user.click(screen.getByRole("button", { name: "Run Test" }));
    await waitFor(() => expect(screen.getByText(/^Done in/)).toBeInTheDocument());
    expect(screen.getByTestId("output")).toHaveTextContent("npm run test: step 3/3");
    expect(within(screen.getByRole("listitem", { name: "Test" })).getByLabelText("Succeeded")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run lint" }));
    await waitFor(() => expect(screen.getByText(/^Exit code 1 after/)).toBeInTheDocument());
    // The earlier run keeps its output.
    await user.click(screen.getByRole("listitem", { name: "Test" }));
    expect(screen.getByTestId("output")).toHaveTextContent("npm run test: step 3/3");
  });

  it("stops a long-running command", async () => {
    const backend = createFakeRunBackend(20);
    const stop = vi.spyOn(backend, "stop");
    const { user } = await renderPanel(backend);
    await user.click(screen.getByRole("button", { name: "Run Start the app" }));
    await waitFor(() => expect(screen.getByTestId("output")).toHaveTextContent("GET /notes 200 (2)"));
    expect(screen.getByText("Running…")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop Start the app" }));
    await waitFor(() => expect(screen.getByText(/^Stopped after/)).toBeInTheDocument());
    expect(stop).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Run Start the app" })).toBeInTheDocument();
  });

  it("finds the commands again when package.json changes", async () => {
    const backend = createFakeRunBackend(20);
    const commands = vi.spyOn(backend, "commands");
    const { fs } = await renderPanel(backend);
    expect(commands).toHaveBeenCalledTimes(1);
    await act(async () => {
      await fs.write("package.json", '{"scripts":{}}');
    });
    await waitFor(() => expect(commands).toHaveBeenCalledTimes(2));
  });
});

describe("run helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(1640)).toBe("1.6 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
  });

  it("keeps the newest output when a run prints a lot", () => {
    const output = new RunOutput();
    const seen: string[] = [];
    output.subscribe((chunk) => seen.push(chunk));
    const line = "x".repeat(100_000);
    for (let i = 0; i < 30; i++) output.append(`${i}${line}`);
    expect(seen).toHaveLength(30);
    expect(output.chunks.length).toBeLessThan(30);
    expect(output.chunks[output.chunks.length - 1].startsWith("29")).toBe(true);
  });
});
