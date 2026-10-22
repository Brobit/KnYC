import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@knyc/core/schemas";
import { createFakeWorkspaceFs } from "@/lib/fake-workspace-fs";
import { SettingsProvider } from "@/lib/settings";
import { createFakeTerminalBackend, type TerminalEvent } from "@/terminal/terminal-backend";
import { buildXtermTheme } from "@/terminal/xterm-theme";
import { useWorkspace, WorkspaceProvider } from "@/workspace/workspace-context";
import css from "@knyc/tokens/tokens.css?raw";

// xterm.js needs a real canvas; a stub records which terminals exist and which one is shown.
vi.mock("@/terminal/TerminalView", () => ({
  TerminalView: ({ active }: { active: boolean }) => <div data-testid="terminal" data-active={active} />,
}));
const { TerminalPanel } = await import("@/terminal/TerminalPanel");

const tokens = (theme: string, mode: string) => {
  const start = css.indexOf(`[data-theme="${theme}"][data-mode="${mode}"]`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};

describe("xterm theme", () => {
  it.each([
    ["focus", "light"],
    ["focus", "dark"],
    ["sage-camel", "light"],
    ["sage-camel", "dark"],
  ] as const)("maps every color of %s %s to a token", (theme, mode) => {
    const values = tokens(theme, mode);
    const built = buildXtermTheme((name) => values[name] ?? "", mode);
    expect(built.background).toBe(values["surface-editor"]);
    expect(built.red).toBe(values.danger);
    for (const [key, value] of Object.entries(built)) expect([key, value]).toEqual([key, expect.stringMatching(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i)]);
  });
});

describe("fake terminal backend", () => {
  it("echoes typing, answers commands and exits", async () => {
    const backend = createFakeTerminalBackend("$ ");
    const events: TerminalEvent[] = [];
    const id = await backend.open(80, 24, (e) => events.push(e));
    await backend.write(id, "lsx\x7f\r");
    await waitFor(() => expect(events.some((e) => e.type === "output" && e.data.includes("ls: not run"))).toBe(true));
    await backend.write(id, "exit\r");
    expect(events[events.length - 1]).toEqual({ type: "exit", code: 0 });
    await expect(backend.write(id, "x")).rejects.toThrow();
  });
});

function OpenFolder() {
  const { pickFolder, folder } = useWorkspace();
  return folder ? null : <button onClick={() => void pickFolder()}>pick</button>;
}

describe("TerminalPanel", () => {
  it("starts a terminal once a folder is open and manages tabs", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider initial={defaultSettings()}>
        <WorkspaceProvider fs={createFakeWorkspaceFs({ "a.ts": "" })}>
          <OpenFolder />
          <TerminalPanel empty={<p>no folder</p>} backend={createFakeTerminalBackend()} />
        </WorkspaceProvider>
      </SettingsProvider>,
    );
    expect(screen.getByText("no folder")).toBeInTheDocument();
    await user.click(screen.getByText("pick"));

    const tabs = () => within(screen.getByRole("tablist", { name: "Terminals" })).queryAllByRole("tab");
    await waitFor(() => expect(tabs().map((t) => t.textContent)).toEqual(["Terminal 1"]));
    await user.click(screen.getByRole("button", { name: "New terminal" }));
    expect(tabs().map((t) => t.textContent)).toEqual(["Terminal 1", "Terminal 2"]);
    expect(screen.getAllByTestId("terminal").map((t) => t.dataset.active)).toEqual(["false", "true"]);

    await user.click(tabs()[0]);
    expect(screen.getAllByTestId("terminal").map((t) => t.dataset.active)).toEqual(["true", "false"]);
    await user.click(screen.getByRole("button", { name: "Close terminal 1" }));
    expect(tabs().map((t) => t.textContent)).toEqual(["Terminal 2"]);
    expect(screen.getAllByTestId("terminal").map((t) => t.dataset.active)).toEqual(["true"]);
  });
});
