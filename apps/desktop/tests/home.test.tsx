import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings, type Workspaces } from "@knyc/core/schemas";
import { createFakeWorkspaceFs } from "@/lib/fake-workspace-fs";
import { createMemoryRecentStore } from "@/lib/recent-workspaces";
import { SettingsProvider } from "@/lib/settings";
import { WorkspaceFsError, type WorkspaceFs } from "@/lib/workspace-fs";
import { Home, timeAgo } from "@/screens/Home";
import { useWorkspace, WorkspaceProvider } from "@/workspace/workspace-context";

const NOW = new Date("2026-10-22T12:00:00+02:00");

const recentDoc = (...entries: [root: string, name: string, at: string][]): Workspaces => ({
  schemaVersion: 1,
  recent: entries.map(([root, name, lastOpenedAt]) => ({ root, name, lastOpenedAt })),
});

function Folder() {
  const { folder } = useWorkspace();
  return <p data-testid="folder">{folder?.root ?? "none"}</p>;
}

function renderHome({ fs = createFakeWorkspaceFs(), recents = createMemoryRecentStore() }: { fs?: WorkspaceFs; recents?: ReturnType<typeof createMemoryRecentStore> } = {}) {
  const onOpened = vi.fn();
  const user = userEvent.setup();
  render(
    <SettingsProvider initial={defaultSettings()}>
      <WorkspaceProvider fs={fs} recents={recents}>
        <Folder />
        <Home onOpened={onOpened} now={NOW} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
  return { user, onOpened, recents };
}

describe("timeAgo", () => {
  it("says how long ago, in words", () => {
    expect(timeAgo("2026-10-22T11:59:40+02:00", NOW, "en")).toBe("now");
    expect(timeAgo("2026-10-22T10:00:00+02:00", NOW, "en")).toBe("2 hours ago");
    expect(timeAgo("2026-10-21T09:00:00+02:00", NOW, "en")).toBe("yesterday");
    expect(timeAgo("2026-10-01T12:00:00+02:00", NOW, "en")).toBe("3 weeks ago");
  });
});

describe("Home", () => {
  it("opens a folder, remembers it and goes to the workspace", async () => {
    const { user, onOpened, recents } = renderHome();
    expect(screen.getByRole("heading", { name: "Welcome to KnYC" })).toBeInTheDocument();
    expect(screen.getByText("The folders you open will be listed here.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open a folder" }));
    expect(onOpened).toHaveBeenCalledOnce();
    expect(screen.getByTestId("folder")).toHaveTextContent("/fake/express-notes");
    await waitFor(() => expect(recents.saved.recent.map((w) => w.name)).toEqual(["express-notes"]));
    expect(await screen.findByRole("listitem", { name: "express-notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to express-notes" })).toBeInTheDocument();
  });

  it("does nothing when the folder dialog is cancelled", async () => {
    const fs: WorkspaceFs = { ...createFakeWorkspaceFs(), pick: async () => null };
    const { user, onOpened, recents } = renderHome({ fs });
    await user.click(screen.getByRole("button", { name: "Open a folder" }));
    expect(onOpened).not.toHaveBeenCalled();
    expect(recents.saved.recent).toEqual([]);
  });

  it("reopens a recent workspace in one click and moves it to the top", async () => {
    const recents = createMemoryRecentStore(
      recentDoc(["/code/todo-next", "todo-next", "2026-10-22T10:00:00+02:00"], ["/fake/express-notes", "express-notes", "2026-10-21T09:00:00+02:00"]),
    );
    const { user, onOpened } = renderHome({ recents });
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["todo-next", "express-notes"]);
    expect(rows[0]).toHaveTextContent("2 hours ago");
    expect(rows[1]).toHaveTextContent("yesterday");

    await user.click(within(rows[1]!).getByRole("button", { name: "Open express-notes" }));
    expect(onOpened).toHaveBeenCalledOnce();
    expect(screen.getByTestId("folder")).toHaveTextContent("/fake/express-notes");
    await waitFor(() => expect(recents.saved.recent.map((w) => w.name)).toEqual(["express-notes", "todo-next"]));
  });

  it("says when a recent folder is gone, and removes it from the list", async () => {
    const fs: WorkspaceFs = {
      ...createFakeWorkspaceFs(),
      open: async (root) => {
        throw new WorkspaceFsError("notFound", `${root} not found`);
      },
    };
    const recents = createMemoryRecentStore(recentDoc(["/code/old", "old", "2026-09-01T10:00:00+02:00"]));
    const { user, onOpened } = renderHome({ fs, recents });
    const row = await screen.findByRole("listitem", { name: "old" });
    await user.click(within(row).getByRole("button", { name: "Open old" }));
    expect(await within(row).findByText("This folder no longer exists. Remove it from the list?")).toBeInTheDocument();
    expect(onOpened).not.toHaveBeenCalled();

    await user.click(within(row).getByRole("button", { name: "Remove old from the list" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "old" })).not.toBeInTheDocument());
    expect(recents.saved.recent).toEqual([]);
  });

  it("shows which model does what", () => {
    renderHome();
    const ai = screen.getByRole("region", { name: "Your AI" });
    expect(within(ai).getByText("Summaries").nextSibling).toHaveTextContent("Claude Code · haiku");
    expect(within(ai).getByText("Planning").nextSibling).toHaveTextContent("Claude Code · sonnet");
  });
});
