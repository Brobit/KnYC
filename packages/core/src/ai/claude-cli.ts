import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { AiError, type AiProvider, type ProviderRequest, type ProviderResponse } from "./types.ts";

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

/** The arguments for one structured, tool-less, non-persisted call. The prompt goes on stdin. */
export function claudeArgs(request: ProviderRequest): string[] {
  // Claude Code rejects the draft-2020-12 `$schema` marker that Zod adds; the schema itself is fine.
  const { $schema: _dialect, ...jsonSchema } = request.jsonSchema;
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    request.model,
    "--system-prompt",
    request.system,
    "--json-schema",
    JSON.stringify(jsonSchema),
    // Answer only: no file access, no commands, no web.
    "--tools",
    "",
    "--no-session-persistence",
  ];
}

interface CliResult {
  type?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** The answer's JSON: the structured output when present, else JSON found in the text result. */
export function extractJson(result: CliResult): unknown {
  if (result.structured_output !== undefined) return result.structured_output;
  const text = (result.result ?? "").trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new AiError("invalid-output", "the answer was not JSON", { text: text.slice(0, 2000) });
  }
}

const AUTH_ERROR = /authenticat|oauth|log ?in|api key|unauthori[sz]ed|\b401\b/i;
const LIMIT_ERROR = /session limit|usage limit|rate limit|limit reached|\b429\b|overloaded/i;

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
      const { stdout, stderr, code, timedOut } = await run(program, [...lead, ...claudeArgs(request)], request.prompt, cwd, request.timeoutMs);
      if (timedOut) throw new AiError("timeout", `Claude Code did not answer within ${Math.round(request.timeoutMs / 1000)} s`);

      let result: CliResult;
      try {
        result = JSON.parse(stdout) as CliResult;
      } catch {
        const message = (stderr || stdout).trim().slice(0, 500) || `exit code ${code}`;
        throw new AiError(AUTH_ERROR.test(message) ? "auth" : "provider", `Claude Code failed: ${message}`);
      }
      if (result.is_error) {
        const message = result.result ?? "unknown error";
        if (LIMIT_ERROR.test(message)) {
          throw new AiError("limit", `Claude Code usage limit reached: ${message}`);
        }
        if (AUTH_ERROR.test(message)) {
          throw new AiError("auth", `Claude Code is not logged in (${message}). Run \`claude\` and use /login.`);
        }
        throw new AiError("provider", `Claude Code error: ${message}`);
      }

      return {
        json: extractJson(result),
        usage: {
          inputTokens: result.usage?.input_tokens ?? 0,
          outputTokens: result.usage?.output_tokens ?? 0,
          cacheReadTokens: result.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: result.usage?.cache_creation_input_tokens ?? 0,
        },
        costUsd: result.total_cost_usd ?? null,
        durationMs: result.duration_ms ?? 0,
      };
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}

function run(program: string, args: string[], stdin: string, cwd: string, timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>((resolve, reject) => {
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
