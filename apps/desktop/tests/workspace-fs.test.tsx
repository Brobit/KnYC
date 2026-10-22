import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain stub rather than vi.fn(): a spy also tracks the rejected promises it returns, which
// vitest then reports as failures even though the wrapper handles them.
let calls: unknown[][] = [];
let reply: () => Promise<unknown> = () => Promise.resolve();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    calls.push(args);
    return reply();
  },
}));

const { createTauriWorkspaceFs, WorkspaceFsError } = await import("@/lib/workspace-fs");
const workspaceFs = createTauriWorkspaceFs();

beforeEach(() => {
  calls = [];
  reply = () => Promise.resolve();
});

describe("workspaceFs", () => {
  it("calls the Rust commands with their argument names", async () => {
    await workspaceFs.write("src/app.ts", "x");
    await workspaceFs.rename("a.ts", "b.ts");
    expect(calls).toEqual([
      ["workspace_write", { path: "src/app.ts", content: "x" }],
      ["workspace_rename", { from: "a.ts", to: "b.ts" }],
    ]);
  });

  it("turns Rust errors into typed errors", async () => {
    reply = () => Promise.reject({ kind: "outsideWorkspace", message: "../secret" });
    const error = await workspaceFs.read("../secret").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkspaceFsError);
    expect(error).toMatchObject({ kind: "outsideWorkspace", message: "../secret" });
  });

  it("wraps anything else as an io error", async () => {
    reply = () => Promise.reject("IPC down");
    const error = await workspaceFs.tree().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "io", message: "IPC down" });
  });
});
