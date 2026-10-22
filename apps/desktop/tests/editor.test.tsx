import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@knyc/core/schemas";
import { DocumentStore, isDirty } from "@/editor/documents";
import { buildMonacoTheme } from "@/editor/monaco-theme";
import { createFakeWorkspaceFs } from "@/lib/fake-workspace-fs";
import { SettingsProvider } from "@/lib/settings";
import { useWorkspace, WorkspaceProvider } from "@/workspace/workspace-context";
import css from "@knyc/tokens/tokens.css?raw";

// Monaco does not run in jsdom: a textarea stands in for it, with the same props.
vi.mock("@/editor/CodeEditor", () => ({
  CodeEditor: ({ docs, active, onEdit }: { docs: { path: string; text: string }[]; active: string | null; onEdit: (p: string, t: string) => void }) => {
    const doc = docs.find((d) => d.path === active);
    return doc ? <textarea aria-label="code" value={doc.text} onChange={(e) => onEdit(doc.path, e.target.value)} /> : null;
  },
}));
const { EditorPanel } = await import("@/editor/EditorPanel");

async function openStore(files: Record<string, string> = { "src/app.ts": "app", "src/b.ts": "b", "src/c.ts": "c" }) {
  const fs = createFakeWorkspaceFs(files);
  await fs.pick();
  return { fs, store: new DocumentStore(fs) };
}

describe("DocumentStore", () => {
  it("opens, edits and saves", async () => {
    const { fs, store } = await openStore();
    await store.open("src/app.ts");
    store.edit("src/app.ts", "app 2");
    expect(isDirty(store.get("src/app.ts")!)).toBe(true);
    await store.save("src/app.ts");
    expect(await fs.read("src/app.ts")).toBe("app 2");
    expect(isDirty(store.get("src/app.ts")!)).toBe(false);
  });

  it("reopening a file switches to its tab; closing activates the neighbour", async () => {
    const { store } = await openStore();
    for (const path of ["src/app.ts", "src/b.ts", "src/c.ts"]) await store.open(path);
    await store.open("src/b.ts");
    expect(store.getSnapshot().tabs).toHaveLength(3);
    expect(store.getSnapshot().active).toBe("src/b.ts");
    store.close("src/b.ts");
    expect(store.getSnapshot().active).toBe("src/c.ts");
    store.close("src/c.ts");
    expect(store.getSnapshot().active).toBe("src/app.ts");
  });

  it("follows the disk when clean and raises a conflict when dirty", async () => {
    const { fs, store } = await openStore();
    await store.open("src/app.ts");
    await store.open("src/b.ts");
    store.edit("src/b.ts", "my b");

    await fs.write("src/app.ts", "from git");
    await fs.write("src/b.ts", "b from git");
    await store.diskChanged(["src/app.ts", "src/b.ts"]);
    expect(store.get("src/app.ts")).toMatchObject({ text: "from git", conflict: null, diskVersion: 2 });
    expect(store.get("src/b.ts")).toMatchObject({ text: "my b", conflict: "changed" });

    await store.keepMine("src/b.ts");
    expect(store.get("src/b.ts")).toMatchObject({ text: "my b", savedText: "b from git", conflict: null });
    await store.save("src/b.ts");
    expect(await fs.read("src/b.ts")).toBe("my b");
  });

  it("closes deleted clean files and keeps dirty ones until the learner decides", async () => {
    const { fs, store } = await openStore();
    await store.open("src/app.ts");
    await store.open("src/b.ts");
    store.edit("src/b.ts", "my b");
    await fs.delete("src");
    await store.diskChanged(["src"]);
    expect(store.get("src/app.ts")).toBeUndefined();
    expect(store.get("src/b.ts")?.conflict).toBe("deleted");

    await store.keepMine("src/b.ts");
    expect(isDirty(store.get("src/b.ts")!)).toBe(true);
  });

  it("follows renames and deletions from the Explorer", async () => {
    const { store } = await openStore();
    await store.open("src/app.ts");
    store.moved("src", "lib");
    expect(store.getSnapshot()).toMatchObject({ active: "lib/app.ts", tabs: [{ path: "lib/app.ts" }] });
    store.deleted("lib");
    expect(store.getSnapshot()).toEqual({ tabs: [], active: null });
  });

  it("shows why a file cannot be opened", async () => {
    const { fs, store } = await openStore();
    vi.spyOn(fs, "read").mockImplementation(() => Promise.reject(new (class extends Error { kind = "notText" })()));
    await store.open("logo.png");
    expect(store.get("logo.png")).toMatchObject({ status: "error" });
  });
});

describe("Monaco themes", () => {
  // Each theme × mode block of tokens.css, read the same way the app reads computed styles.
  const block = (theme: string, mode: string) => {
    const start = css.indexOf(`[data-theme="${theme}"][data-mode="${mode}"]`);
    const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  };

  it.each([
    ["focus", "light"],
    ["focus", "dark"],
    ["sage-camel", "light"],
    ["sage-camel", "dark"],
  ] as const)("builds %s %s from its tokens", (theme, mode) => {
    const tokens = block(theme, mode);
    const built = buildMonacoTheme((name) => tokens[name] ?? "", mode);
    expect(built.base).toBe(mode === "dark" ? "vs-dark" : "vs");
    expect(built.colors["editor.background"]).toBe(tokens["surface-editor"]);
    expect(built.rules.find((r) => r.token === "keyword")?.foreground).toBe(tokens.accent.slice(1).toLowerCase());
    for (const value of Object.values(built.colors)) expect(value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
  });
});

function OpenButton({ path }: { path: string }) {
  const { openFile } = useWorkspace();
  return <button onClick={() => openFile(path)}>open {path}</button>;
}

async function renderPanel() {
  const fs = createFakeWorkspaceFs({ "src/app.ts": "app", "src/b.ts": "b" });
  function PickOnMount() {
    const { pickFolder, folder } = useWorkspace();
    return folder ? null : <button onClick={() => void pickFolder()}>pick</button>;
  }
  render(
    <SettingsProvider initial={defaultSettings()}>
      <WorkspaceProvider fs={fs}>
        <PickOnMount />
        <OpenButton path="src/app.ts" />
        <OpenButton path="src/b.ts" />
        <EditorPanel empty={<p>no file</p>} />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText("pick"));
  return { fs, user };
}

const tabList = () => screen.getByRole("tablist", { name: "Open files" });

describe("EditorPanel", () => {
  it("opens tabs, marks unsaved work and saves with Ctrl+S", async () => {
    const { fs, user } = await renderPanel();
    expect(screen.getByText("no file")).toBeInTheDocument();
    await user.click(screen.getByText("open src/app.ts"));
    await user.click(screen.getByText("open src/b.ts"));
    expect(within(tabList()).getAllByRole("tab").map((t) => t.getAttribute("title"))).toEqual(["src/app.ts", "src/b.ts"]);

    await user.type(await screen.findByRole("textbox", { name: "code" }), "!");
    expect(within(tabList()).getByLabelText("Unsaved changes")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await waitFor(() => expect(within(tabList()).queryByLabelText("Unsaved changes")).not.toBeInTheDocument());
    expect(await fs.read("src/b.ts")).toBe("b!");
  });

  it("asks before closing unsaved work", async () => {
    const { fs, user } = await renderPanel();
    await user.click(screen.getByText("open src/app.ts"));
    await user.type(await screen.findByRole("textbox", { name: "code" }), "!");

    await user.click(screen.getByRole("button", { name: "Close app.ts" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("textbox", { name: "code" })).toHaveValue("app!");

    await user.click(screen.getByRole("button", { name: "Close app.ts" }));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("no file")).toBeInTheDocument());
    expect(await fs.read("src/app.ts")).toBe("app!");

    await user.click(screen.getByText("open src/app.ts"));
    await user.type(await screen.findByRole("textbox", { name: "code" }), "?");
    await user.click(screen.getByRole("button", { name: "Close app.ts" }));
    await user.click(await screen.findByRole("button", { name: "Don’t save" }));
    await waitFor(() => expect(screen.getByText("no file")).toBeInTheDocument());
    expect(await fs.read("src/app.ts")).toBe("app!");
  });

  it("lets the learner choose when an edited file changes on disk", async () => {
    const { fs, user } = await renderPanel();
    await user.click(screen.getByText("open src/app.ts"));
    await user.type(await screen.findByRole("textbox", { name: "code" }), "!");
    await act(async () => {
      await fs.write("src/app.ts", "from git");
    });
    expect(await screen.findByText("This file changed on disk while you were editing it.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load the disk version" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "code" })).toHaveValue("from git"));
    expect(screen.queryByText("This file changed on disk while you were editing it.")).not.toBeInTheDocument();
  });
});
