// The Claude Code CLI call, minus the process: its arguments and how its output reads. Shared by
// the CLI's ClaudeCliProvider (Node, ai/claude-cli.ts) and the desktop app (the process runs in
// Rust), so both report the same errors. Browser-safe.

import { AiError, type ProviderRequest, type ProviderResponse } from "./types.ts";

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

export interface CliResult {
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

/** What one run of `claude` produced. */
export interface ClaudeRun {
  stdout: string;
  stderr: string;
  /** null when killed (timeout) or ended by a signal. */
  code: number | null;
  timedOut: boolean;
}

/** Turns a finished run into the answer, or the AiError the user can act on. */
export function interpretClaudeRun(run: ClaudeRun, timeoutMs: number): ProviderResponse {
  if (run.timedOut) throw new AiError("timeout", `Claude Code did not answer within ${Math.round(timeoutMs / 1000)} s`);

  let result: CliResult;
  try {
    result = JSON.parse(run.stdout) as CliResult;
  } catch {
    const message = (run.stderr || run.stdout).trim().slice(0, 500) || `exit code ${run.code}`;
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
}
