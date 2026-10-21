// AI layer contracts (design/02-analysis-pipeline.md ⑤–⑨, design/06 M1 decision: the user's
// Claude Code CLI is the first provider). Every call asks for JSON matching a Zod schema.

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** One request to a provider: instructions, input, and the JSON shape the answer must have. */
export interface ProviderRequest {
  model: string;
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  timeoutMs: number;
}

export interface ProviderResponse {
  /** The answer as JSON (already parsed), before schema validation. */
  json: unknown;
  usage: Usage;
  /** As reported by the provider; null when unknown. Subscription plans may report an estimate. */
  costUsd: number | null;
  durationMs: number;
}

export interface AiProvider {
  /** Stable id used in cache keys and ModelRef.providerId: "claude-cli". */
  readonly id: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export type AiErrorKind =
  /** Not logged in / key rejected: the user has to act. */
  | "auth"
  /** Usage or rate limit reached (e.g. a subscription session limit): wait, then retry. */
  | "limit"
  /** The provider program or service is missing or unreachable. */
  | "unavailable"
  | "timeout"
  /** Still no valid answer after the retries. */
  | "invalid-output"
  | "provider";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly details?: unknown;

  constructor(kind: AiErrorKind, message: string, details?: unknown) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.details = details;
  }
}
