import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Explorer } from "@/explorer/Explorer";
import { foldersToReload, movedPath, nameProblem, pruneChildren, sortEntries, visibleRows, type TreeNode } from "@/explorer/tree";
import { createFakeWorkspaceFs } from "@/lib/fake-workspace-fs";
import { WorkspaceFsError } from "@/lib/workspace-fs";
import { useWorkspace, WorkspaceProvider } from "@/workspace/workspace-context";

const node = (path: string, kind: TreeNode["kind"] = "file"): TreeNode => ({ path, kind, name: path.split("/").pop()! });

describe("tree model", () => {
  it("sorts folders first, then names in natural order", () => {
    const sorted = sortEntries([
      { path: "file10.ts", kind: "file" },
      { path: "b", kind: "dir" },
      { path: "File2.ts", kind: "file" },
      { path: "a", kind: "dir" },
    ]);
    expect(sorted.map((n) => n.name)).toEqual(["a", "b", "File2.ts", "file10.ts"]);
  });

  it("shows only loaded and expanded folders", () => {
    const children = new Map([
      ["", [node("src", "dir"), node("README.md")]],
      ["src", [node("src/lib", "dir"), node("src/app.ts")]],
      ["src/lib", [node("src/lib/util.ts")]],
    ]);
    const rows = visibleRows(children, new Set(["src"]));
    expect(rows.map((r) => [r.path, r.depth, r.expanded])).toEqual([
      ["src", 0, true],
      ["src/lib", 1, false],
      ["src/app.ts", 1, false],
      ["README.md", 0, false],
    ]);
  });

  it("reloads only the loaded folders a change touches", () => {
    const children = new Map([
      ["", []],
      ["src", []],
    ]);
    expect(foldersToReload(["src/app.ts", "src/deep/x.ts", "src"], children).sort()).toEqual(["", "src"]);
  });

  it("keeps the root and drops folders that disappeared", () => {
    const children = new Map([
      ["", [node("src", "dir"), node("old", "dir")]],
      ["src", []],
      ["old", [node("old/sub", "dir")]],
      ["old/sub", []],
    ]);
    pruneChildren(children, "", [node("src", "dir")]);
    expect([...children.keys()].sort()).toEqual(["", "src"]);
  });

  it("follows renames and checks names", () => {
    expect(movedPath("src/auth/guard.ts", "src/auth", "src/security")).toBe("src/security/guard.ts");
    expect(movedPath("src/authx.ts", "src/auth", "src/security")).toBe("src/authx.ts");
    const siblings = [node("app.ts")];
    expect(nameProblem("  ", siblings)).toBe("empty");
    expect(nameProblem("a/b.ts", siblings)).toBe("separator");
    expect(nameProblem("..", siblings)).toBe("dots");
    expect(nameProblem("App.ts", siblings)).toBe("taken");
    expect(nameProblem("app.ts", siblings, "app.ts")).toBeNull();
    expect(nameProblem("server.ts", siblings)).toBeNull();
  });
});

describe("fake workspace fs", () => {
  it("refuses the same paths as Rust", async () => {
    const fs = createFakeWorkspaceFs({ "src/app.ts": "" });
    await expect(fs.list("")).rejects.toMatchObject({ kind: "noWorkspace" });
    await fs.pick();
    for (const path of ["../x", "/etc/passwd", "C:/Windows", "src/../../x"]) {
      await expect(fs.read(path)).rejects.toBeInstanceOf(WorkspaceFsError);
      await expect(fs.read(path)).rejects.toMatchObject({ kind: "outsideWorkspace" });
    }
    await expect(fs.delete("")).rejects.toMatchObject({ kind: "outsideWorkspace" });
    await expect(fs.createFile("lib/x.ts")).rejects.toMatchObject({ kind: "notFound" });
    await expect(fs.createFile("src/app.ts")).rejects.toMatchObject({ kind: "alreadyExists" });
  });
});

function ActiveFile() {
  const { activeFile } = useWorkspace();
  return <output aria-label="active file">{activeFile ?? ""}</output>;
}

function renderExplorer() {
  const fs = createFakeWorkspaceFs({ "src/app.ts": "app", "src/lib/util.ts": "util", "README.md": "# hi" });
  render(
    <WorkspaceProvider fs={fs}>
      <Explorer />
      <ActiveFile />
    </WorkspaceProvider>,
  );
  return fs;
}

const tree = () => screen.getByRole("tree");
const item = (path: string) => within(tree()).getByTitle(path);
const paths = () => within(tree()).queryAllByRole("treeitem").map((el) => el.getAttribute("title"));

describe("Explorer", () => {
  it("opens a folder, expands lazily and opens files", async () => {
    const user = userEvent.setup();
    renderExplorer();
    await user.click(screen.getByRole("button", { name: "Open folder" }));
    await waitFor(() => expect(paths()).toEqual(["src", "README.md"]));

    await user.click(item("src"));
    await waitFor(() => expect(paths()).toEqual(["src", "src/lib", "src/app.ts", "README.md"]));
    await user.click(item("src/app.ts"));
    expect(screen.getByLabelText("active file")).toHaveTextContent("src/app.ts");

    // Keyboard: up to src/lib, right to expand it.
    await user.keyboard("{ArrowUp}{ArrowRight}");
    await waitFor(() => expect(paths()).toContain("src/lib/util.ts"));
  });

  it("creates, renames and deletes with confirmation", async () => {
    const user = userEvent.setup();
    const fs = renderExplorer();
    await user.click(screen.getByRole("button", { name: "Open folder" }));
    await waitFor(() => expect(paths()).toContain("src"));
    await user.click(item("src"));
    await waitFor(() => expect(paths()).toContain("src/app.ts"));

    // New file in the selected folder.
    await user.click(screen.getByRole("button", { name: "New file" }));
    const input = await screen.findByRole("textbox", { name: "New file" });
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "guard.ts{Enter}");
    await waitFor(() => expect(paths()).toContain("src/guard.ts"));
    expect(await fs.read("src/guard.ts")).toBe("");
    expect(screen.getByLabelText("active file")).toHaveTextContent("src/guard.ts");

    // A taken name is refused before reaching the disk.
    await user.click(item("src/app.ts"));
    await user.keyboard("{F2}");
    const rename = await screen.findByRole("textbox", { name: "Rename" });
    await waitFor(() => expect(rename).toHaveFocus());
    await user.clear(rename);
    await user.type(rename, "guard.ts");
    expect(screen.getByText("Something with this name already exists here.")).toBeInTheDocument();
    await user.clear(rename);
    await user.type(rename, "main.ts{Enter}");
    await waitFor(() => expect(paths()).toContain("src/main.ts"));
    expect(screen.getByLabelText("active file")).toHaveTextContent("src/main.ts");

    // Delete asks first; Cancel keeps the file.
    await user.keyboard("{Delete}");
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(paths()).toContain("src/main.ts");
    await user.click(item("src/main.ts"));
    await user.keyboard("{Delete}");
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(paths()).not.toContain("src/main.ts"));
    await expect(fs.read("src/main.ts")).rejects.toMatchObject({ kind: "notFound" });
    // Its tab closed; the other open file (created above) is active again.
    expect(screen.getByLabelText("active file")).toHaveTextContent("src/guard.ts");
  });

  it("follows changes made outside the app", async () => {
    const user = userEvent.setup();
    const fs = renderExplorer();
    await user.click(screen.getByRole("button", { name: "Open folder" }));
    await waitFor(() => expect(paths()).toContain("src"));
    await user.click(item("src"));
    await waitFor(() => expect(paths()).toContain("src/app.ts"));

    await act(async () => {
      await fs.write("src/routes.ts", "");
      await fs.delete("README.md");
    });
    await waitFor(() => expect(paths()).toEqual(["src", "src/lib", "src/app.ts", "src/routes.ts"]));
  });
});
