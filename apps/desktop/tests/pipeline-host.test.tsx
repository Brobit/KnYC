import { beforeEach, describe, expect, it, vi } from "vitest";
import { KnycSysError, scanProject } from "@knyc/core";

// A plain stub rather than vi.fn(): a spy also tracks the rejected promises it returns, which
// vitest then reports as failures even though the host handles them.
let calls: unknown[][] = [];
let reply: (command: string) => Promise<unknown> = () => Promise.resolve();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    calls.push(args);
    return reply(args[0] as string);
  },
}));

const { TauriHost, pickSourceFolder, pipelineDataDir } = await import("@/lib/pipeline-host");

beforeEach(() => {
  calls = [];
  reply = () => Promise.resolve();
});

describe("TauriHost", () => {
  it("calls the Rust host commands with their argument names", async () => {
    const host = new TauriHost();
    await host.readFile("/data/a.json");
    await host.writeFile("/data/a.json", "{}");
    await host.appendFile("/data/w/.git/info/exclude", "dist/\n");
    await host.copyFile("/src/a.ts", "/data/w/a.ts");
    await host.remove("/data/w");
    await host.git("/data/w", ["init", "-q"]);
    await host.sys({ op: "graph", folder: "/data/w" });
    await pipelineDataDir();
    await pickSourceFolder();
    expect(calls).toEqual([
      ["host_read_file", { path: "/data/a.json" }],
      ["host_write_file", { path: "/data/a.json", content: "{}" }],
      ["host_append_file", { path: "/data/w/.git/info/exclude", content: "dist/\n" }],
      ["host_copy_file", { from: "/src/a.ts", to: "/data/w/a.ts" }],
      ["host_remove", { path: "/data/w" }],
      ["host_git", { cwd: "/data/w", args: ["init", "-q"] }],
      ["host_sys", { request: { op: "graph", folder: "/data/w" } }],
      ["pipeline_data_dir"],
      ["pipeline_pick_source"],
    ]);
  });

  it("rejects with Errors, and KnycSysError for knyc-sys steps", async () => {
    const host = new TauriHost();
    reply = () => Promise.reject("/etc/passwd is outside the KnYC data folder and the project folders you picked");
    const read = await host.readFile("/etc/passwd").catch((e: unknown) => e);
    expect(read).toBeInstanceOf(Error);
    expect((read as Error).message).toContain("outside the KnYC data folder");

    reply = () => Promise.reject("knyc-sys scan failed: no such folder");
    const scan = await host.sys({ op: "scan", folder: "/nope", toolchains: false }).catch((e: unknown) => e);
    expect(scan).toBeInstanceOf(KnycSysError);
  });

  it("runs the shared pipeline code: scanProject validates what Rust returns", async () => {
    const host = new TauriHost();
    reply = () =>
      Promise.resolve({
        root: "/data/s",
        hash: "blake3:ab",
        languages: [],
        frameworks: [],
        testRunners: [],
        commands: [{ root: ".", install: "npm ci", build: null, test: "npm run test", run: null }],
        files: [],
        excluded: [],
        secretLines: [],
      });
    const scan = await scanProject(host, "/data/s", { toolchains: false });
    expect(scan.commands[0].test).toBe("npm run test");
    expect(calls).toEqual([["host_sys", { request: { op: "scan", folder: "/data/s", toolchains: false } }]]);
  });
});
