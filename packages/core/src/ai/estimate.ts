// Rough size estimates shown before AI stages run (design/02 D4). Token counts are approximate
// (about 4 characters per token for code and English); real usage is reported after each call.

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Price per million tokens. Left to configuration: KnYC doesn't hard-code provider prices. */
export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface Estimate {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Only when pricing is known (API keys); subscriptions via the CLI have no per-call price. */
  costUsd: number | null;
}

export function estimate(
  calls: { input: string; expectedOutputTokens: number }[],
  pricing?: Pricing,
): Estimate {
  const inputTokens = calls.reduce((sum, c) => sum + estimateTokens(c.input), 0);
  const outputTokens = calls.reduce((sum, c) => sum + c.expectedOutputTokens, 0);
  const costUsd = pricing
    ? (inputTokens * pricing.inputPerMTok + outputTokens * pricing.outputPerMTok) / 1_000_000
    : null;
  return { calls: calls.length, inputTokens, outputTokens, costUsd };
}
