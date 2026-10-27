import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { claudeArgs, interpretClaudeRun, type ClaudeRun } from "./claude-output.ts";
import { AiError, type AiProvider, type ProviderRequest, type ProviderResponse } from "./types.ts";

export { claudeArgs, extractJson } from "./claude-output.ts";

export interface ClaudeCliOptions {
  /**
   * Program and leading arguments, e.g. ["C:/…/claude.exe"]. Default: `claude` from PATH, then
   * the standard install location (~/.local/bin). Tests pass [node, fake-claude.mjs].
   */
  command?: string[];
}

/** Finds the Claude Code executable. `.cmd` shims are skipped: they need a shell to run. */
export function findClaude(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const names = process.platform === "win32" ? ["claude.exe"] : ["claude"];
  const dirs = [...(env.PATH ?? env.Path ?? "").split(delimiter), join(homedir(), ".local", "bin")];
  for (const dir of dirs.filter(Boolean)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** The CLI's provider: runs `claude` with Node. The desktop app runs it from Rust instead. */
export class ClaudeCliProvider implements AiProvider {
  readonly id = "claude-cli";

  private readonly options: ClaudeCliOptions;

  constructor(options: ClaudeCliOptions = {}) {
    this.options = options;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const command = this.options.command ?? [findClaude()].filter((c): c is string => !!c);
    const [program, ...lead] = command;
    if (!program) {
      throw new AiError("unavailable", "Claude Code CLI not found. Install it, or set its path in Settings → AI providers.");
    }

    // An empty folder: no project instructions (CLAUDE.md) leak into the answer.
    const cwd = await mkdtemp(join(tmpdir(), "knyc-ai-"));
    try {
      const result = await run(program, [...lead, ...claudeArgs(request)], request.prompt, cwd, request.timeoutMs);
      return interpretClaudeRun(result, request.timeoutMs);
    } finally {
      // Windows can still hold the folder for a moment after the CLI exits (EBUSY); an empty
      // folder left in the temp directory is harmless, an answer lost to it isn't.
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    }
  }
}

function run(program: string, args: string[], stdin: string, cwd: string, timeoutMs: number) {
  return new Promise<ClaudeRun>((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new AiError("unavailable", `could not start Claude Code: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
    child.stdin.end(stdin);
  });
}
