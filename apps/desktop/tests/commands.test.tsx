import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@knyc/core/schemas";
import { CommandPalette } from "@/commands/CommandPalette";
import {
  CommandRegistry,
  CommandsProvider,
  formatShortcut,
  matches,
  parseShortcut,
  reachesAppFromTerminal,
  useRegisterCommands,
  type Command,
} from "@/commands/commands";
import { Explorer } from "@/explorer/Explorer";
import { createFakeWorkspaceFs } from "@/lib/fake-workspace-fs";
import { SettingsProvider } from "@/lib/settings";
import { useWorkspace, WorkspaceProvider } from "@/workspace/workspace-context";

// cmdk scrolls the selected item into view; jsdom has no layout.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

describe("shortcuts", () => {
  it("reads, matches and shows shortcuts per platform", () => {
    const save = parseShortcut("Mod+S");
    expect(matches(save, key({ key: "s", ctrlKey: true }), false)).toBe(true);
    expect(matches(save, key({ key: "s", metaKey: true }), true)).toBe(true);
    expect(matches(save, key({ key: "s", metaKey: true }), false)).toBe(false);
    expect(matches(save, key({ key: "S", ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(matches(parseShortcut("Mod+Shift+P"), key({ key: "P", ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(matches(parseShortcut("Mod+,"), key({ key: ",", ctrlKey: true }), false)).toBe(true);

    expect(formatShortcut("Mod+Shift+P", false)).toBe("Ctrl+Shift+P");
    expect(formatShortcut("Mod+Shift+P", true)).toBe("⇧⌘P");
    expect(formatShortcut("Mod+,", false)).toBe("Ctrl+,");
  });

  it("leaves Ctrl+letter to the shell inside a terminal", () => {
    expect(reachesAppFromTerminal(parseShortcut("Mod+K"), false)).toBe(false);
    expect(reachesAppFromTerminal(parseShortcut("Mod+Shift+P"), false)).toBe(true);
    expect(reachesAppFromTerminal(parseShortcut("Mod+,"), false)).toBe(true);
    expect(reachesAppFromTerminal(parseShortcut("Mod+K"), true)).toBe(true);
  });

  it("registers, replaces and removes commands", () => {
    const registry = new CommandRegistry();
    const first: Command = { id: "a", title: "A", group: "app", shortcuts: ["Mod+K"], run: () => {} };
    const remove = registry.add([first]);
    const replaced = { ...first, title: "A2" };
    const removeReplaced = registry.add([replaced]);
    remove(); // the replaced version stays
    expect(registry.getSnapshot()).toEqual([replaced]);
    expect(registry.forEvent(key({ key: "k", ctrlKey: true }), false, false)).toBe(replaced);
    expect(registry.forEvent(key({ key: "k", ctrlKey: true }), true, false)).toBeUndefined();
    removeReplaced();
    expect(registry.getSnapshot()).toEqual([]);
  });
});

function Register({ commands }: { commands: Command[] }) {
  useRegisterCommands(() => commands, [commands]);
  return null;
}

function OpenFolder() {
  const { pickFolder, folder, activeFile } = useWorkspace();
  return folder ? <p data-testid="active">{activeFile ?? "none"}</p> : <button onClick={() => void pickFolder()}>pick</button>;
}

function renderApp({ commands = [], workspaceVisible = true, explorer = false }: { commands?: Command[]; workspaceVisible?: boolean; explorer?: boolean } = {}) {
  const fs = createFakeWorkspaceFs({ "src/index.ts": "export {}", "src/app.ts": "", "README.md": "# hi" });
  const showWorkspace = vi.fn();
  const user = userEvent.setup();
  render(
    <SettingsProvider initial={defaultSettings()}>
      <CommandsProvider workspaceVisible={workspaceVisible} showWorkspace={showWorkspace}>
        <WorkspaceProvider fs={fs}>
          <Register commands={commands} />
          <OpenFolder />
          {explorer && <Explorer />}
          <CommandPalette />
        </WorkspaceProvider>
      </CommandsProvider>
    </SettingsProvider>,
  );
  return { user, showWorkspace };
}

describe("shortcut handler", () => {
  it("runs a command from anywhere but leaves terminal keys to the shell", () => {
    const run = vi.fn();
    renderApp({ commands: [{ id: "x", title: "X", group: "view", shortcuts: ["Mod+B"], run }] });
    const event = key({ key: "b", ctrlKey: true });
    window.dispatchEvent(event);
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    const terminal = document.createElement("div");
    terminal.className = "xterm";
    document.body.append(terminal);
    fireEvent.keyDown(terminal, { key: "b", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    terminal.remove();
  });

  it("waits for the workspace before running its shortcuts", () => {
    const run = vi.fn();
    renderApp({ commands: [{ id: "x", title: "X", group: "editor", shortcuts: ["Mod+S"], scope: "workspace", run }], workspaceVisible: false });
    window.dispatchEvent(key({ key: "s", ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("command palette", () => {
  it("opens with Ctrl+K, lists commands by group with their shortcut, filters and runs one", async () => {
    const save = vi.fn();
    const reset = vi.fn();
    const { user, showWorkspace } = renderApp({
      workspaceVisible: false,
      commands: [
        { id: "editor.save", title: "Save file", group: "editor", shortcuts: ["Mod+S"], scope: "workspace", run: save },
        { id: "view.resetLayout", title: "Reset layout", group: "view", run: reset },
      ],
    });
    act(() => void window.dispatchEvent(key({ key: "k", ctrlKey: true })));
    const dialog = await screen.findByRole("dialog", { name: "Commands" });
    expect(within(dialog).getByText("Editor")).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Save file/ })).toHaveTextContent("Ctrl+S");

    await user.type(within(dialog).getByRole("combobox"), "save");
    expect(within(dialog).queryByRole("option", { name: /Reset layout/ })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(save).toHaveBeenCalledTimes(1);
    // A workspace command brings the workspace on screen first.
    expect(showWorkspace).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes with the same shortcut", async () => {
    renderApp();
    act(() => void window.dispatchEvent(key({ key: "k", ctrlKey: true })));
    await screen.findByRole("dialog");
    act(() => void window.dispatchEvent(key({ key: "P", ctrlKey: true, shiftKey: true })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("goes to a file of the open folder with Ctrl+P", async () => {
    const { user, showWorkspace } = renderApp();
    // No folder, no "Go to file".
    window.dispatchEvent(key({ key: "p", ctrlKey: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByText("pick"));
    await screen.findByTestId("active");
    act(() => void window.dispatchEvent(key({ key: "p", ctrlKey: true })));
    const dialog = await screen.findByRole("dialog", { name: "Go to file…" });
    expect(await within(dialog).findByRole("option", { name: /README\.md/ })).toBeInTheDocument();
    await user.type(within(dialog).getByRole("combobox"), "index");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("src/index.ts"));
    expect(showWorkspace).toHaveBeenCalled();
  });

  it("offers the Explorer's actions once a folder is open", async () => {
    const { user } = renderApp({ explorer: true });
    await user.click(screen.getByRole("button", { name: "Open folder" }));
    await screen.findByRole("tree");
    act(() => void window.dispatchEvent(key({ key: "k", ctrlKey: true })));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox"), "new file");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("textbox", { name: "New file" })).toHaveFocus();
  });
});
