import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkoutStep, dirnamePath, FileCache, joinPath, MemoryHost, sha256Hex } from "../src/index.ts";
import { sysArgs } from "../src/node.ts";

const src = fileURLToPath(new URL("../src", import.meta.url));
const NODE_ONLY = new Set(["node.ts", join("host", "node.ts"), join("ai", "claude-cli.ts")]);

describe("browser-safe core", () => {
  it("has no node:* import outside the Node entry point", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
    const offenders = walk(src)
      .filter((file) => !NODE_ONLY.has(file.slice(src.length + 1)))
      .filter((file) => /from "node:/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("host helpers", () => {
  it("joins paths with / on any OS and hashes like node:crypto", () => {
    expect(joinPath("C:\\work\\", "/src/a.ts")).toBe("C:\\work/src/a.ts");
    expect(joinPath("/tmp/x", "", ".git", "info")).toBe("/tmp/x/.git/info");
    expect(dirnamePath("src/a/b.ts")).toBe("src/a");
    expect(dirnamePath("b.ts")).toBe("");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("maps knyc-sys steps to the binary's arguments", () => {
    expect(sysArgs({ op: "scan", folder: "/p", toolchains: false })).toEqual(["scan", "/p", "--no-toolchains"]);
    expect(sysArgs({ op: "run", cwd: "/w", command: "npm run build", timeoutMs: 5, env: { PORT: "0" }, report: "r.json" })).toEqual(
      ["run", "--cwd", "/w", "--timeout-ms", "5", "--env", "PORT=0", "--report", "r.json", "--", "npm", "run", "build"],
    );
  });
});

describe("pipeline on a fake host", () => {
  it("caches AI answers through the host", async () => {
    const host = new MemoryHost();
    const cache = new FileCache(host, "/cache/ai");
    const value = { json: { a: 1 }, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: null, at: "2026-10-22T00:00:00.000Z" };
    await cache.set("k", value);
    expect(host.files.has("/cache/ai/k.json")).toBe(true);
    expect(await cache.get("k")).toEqual(value);
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("checks out a step: git checkout + clean, old build output removed, then the build", async () => {
    const host = new MemoryHost({
      files: { "/w/tsconfig.json": '{ "compilerOptions": { "outDir": "./build" } }', "/w/build/app.js": "old" },
      sys: () => ({ status: "pass" }),
    });
    const scan = { commands: [{ root: ".", install: null, build: "npm run build", test: null, run: null }] } as never;
    const { build } = await checkoutStep(host, "/w", "p/s02", scan, 1000);
    expect(build.status).toBe("pass");
    expect(host.gitCalls.map((c) => c.args.join(" "))).toEqual(["checkout -q -f p/s02", "clean -fdq"]);
    expect(host.files.has("/w/build/app.js")).toBe(false);
    expect(host.sysCalls).toEqual([{ op: "run", cwd: "/w", command: "npm run build", timeoutMs: 1000, env: {}, report: undefined }]);
  });
});
