// The Node host, for the CLI and tests (`@knyc/core/node`): files with node:fs, git with
// execFile, the knyc-sys steps through the knyc-sys binary.

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { KnycSysError } from "../sys/knyc-sys.ts";
import type { Host, SysRequest } from "./host.ts";

const exec = promisify(execFile);

/**
 * The knyc-sys binary: $KNYC_SYS, else the workspace build (release, then debug).
 * Packaged apps call the crates directly instead.
 */
export function findKnycSys(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.KNYC_SYS) return env.KNYC_SYS;
  const exe = process.platform === "win32" ? "knyc-sys.exe" : "knyc-sys";
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  return ["release", "debug"].map((profile) => join(repo, "target", profile, exe)).find((p) => existsSync(p));
}

/** The knyc-sys command line for a step. */
export function sysArgs(request: SysRequest): string[] {
  switch (request.op) {
    case "intake":
      return ["intake", request.source, request.sandbox];
    case "scan":
      return ["scan", request.folder, ...(request.toolchains ? [] : ["--no-toolchains"])];
    case "graph":
      return ["graph", request.folder];
    case "run": {
      const args = ["run", "--cwd", request.cwd, "--timeout-ms", String(request.timeoutMs)];
      for (const [k, v] of Object.entries(request.env)) args.push("--env", `${k}=${v}`);
      if (request.report) args.push("--report", request.report);
      if (request.container) args.push("--docker-image", request.container.image, "--mount", request.container.mount);
      return [...args, "--", ...request.command.split(" ").filter(Boolean)];
    }
    case "docker":
      return ["docker", "--cwd", request.cwd, "--timeout-ms", String(request.timeoutMs), "--spec", JSON.stringify(request.spec)];
    case "http":
      return [
        "http",
        "--cwd",
        request.cwd,
        "--timeout-ms",
        String(request.timeoutMs),
        "--spec",
        JSON.stringify({ server: request.server, requests: request.requests }),
        ...(request.container ? ["--docker-image", request.container.image, "--mount", request.container.mount] : []),
      ];
    case "ui":
      if (!request.browsers) throw new Error("UI checks need the folder Chromium is in");
      return [
        "ui",
        "--cwd",
        request.cwd,
        "--timeout-ms",
        String(request.timeoutMs),
        "--spec",
        JSON.stringify({ server: request.server, tests: request.tests, companions: request.companions ?? [] }),
        "--browsers",
        request.browsers,
        ...(request.container ? ["--docker-image", request.container.image, "--mount", request.container.mount] : []),
      ];
    case "browser":
      if (!request.browsers) throw new Error("say which folder Chromium is in");
      return ["browser", request.action, "--browsers", request.browsers];
  }
}

let tmpCounter = 0;

export class NodeHost implements Host {
  private readonly binary: string | undefined;

  /** `binary`: the knyc-sys executable (default: findKnycSys()). */
  constructor(options: { binary?: string } = {}) {
    this.binary = options.binary ?? findKnycSys();
  }

  readFile(path: string) {
    return readFile(path, "utf8");
  }

  async writeFile(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${++tmpCounter}.tmp`;
    await writeFile(tmp, content);
    await rename(tmp, path);
  }

  async appendFile(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, content);
  }

  async copyFile(from: string, to: string) {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }

  remove(path: string) {
    return rm(path, { recursive: true, force: true });
  }

  async git(cwd: string, args: string[]) {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  }

  async sys(request: SysRequest): Promise<unknown> {
    const binary = this.binary;
    if (!binary) throw new KnycSysError("knyc-sys not found: build it with `cargo build -p knyc-sys` or set KNYC_SYS");
    const args = sysArgs(request);
    const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
      child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
      child.on("error", (e) => reject(new KnycSysError(`could not start knyc-sys: ${e.message}`)));
      child.on("close", (code) => resolve({ stdout, stderr, code }));
    });
    if (code !== 0) throw new KnycSysError(`knyc-sys ${request.op} failed: ${stderr.trim() || `exit code ${code}`}`);
    return JSON.parse(stdout);
  }
}
