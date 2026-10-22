import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiError, type AiErrorKind } from "@knyc/core";
import { defaultSettings } from "@knyc/core/schemas";
import i18n from "@/i18n";
import { aiErrorMessage } from "@/lib/ai-errors";
import { AppClaudeProvider, createAppAiClient, type ClaudeCaller, type ClaudeOutcome } from "@/lib/claude-provider";
import { testClaudeCall } from "@/settings/settings-backend";

/** What Rust's ai_claude_call returns for a finished run printing `result` as Claude Code's JSON. */
const finished = (result: Record<string, unknown>, extra: Partial<ClaudeOutcome> = {}): ClaudeOutcome => ({
  found: true,
  startError: null,
  stdout: JSON.stringify({ type: "result", is_error: false, duration_ms: 42, usage: { input_tokens: 10, output_tokens: 2 }, ...result }),
  stderr: "",
  code: 0,
  timedOut: false,
  truncated: false,
  ...extra,
});

const request = { model: "haiku", system: "You name programmers.", prompt: "One name.", jsonSchema: { type: "object" }, timeoutMs: 5000 };

const failure = async (outcome: ClaudeOutcome | (() => Promise<ClaudeOutcome>)) => {
  const caller: ClaudeCaller = typeof outcome === "function" ? outcome : async () => outcome;
  const error = await new AppClaudeProvider(caller).complete(request).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AiError);
  return (error as AiError).kind;
};

describe("AppClaudeProvider", () => {
  it("sends data only and reads the structured answer", async () => {
    const calls: unknown[] = [];
    const provider = new AppClaudeProvider(async (call) => (calls.push(call), finished({ structured_output: { name: "Ada" } })));
    const answer = await provider.complete(request);
    expect(answer.json).toEqual({ name: "Ada" });
    expect(answer.usage.inputTokens).toBe(10);
    expect(calls).toEqual([request]);
  });

  it.each<[string, ClaudeOutcome | (() => Promise<ClaudeOutcome>), AiErrorKind]>([
    ["not installed", { ...finished({}), found: false }, "unavailable"],
    ["not startable", { ...finished({}), startError: "access denied" }, "unavailable"],
    ["timed out", finished({}, { timedOut: true, code: null }), "timeout"],
    ["logged out", finished({ is_error: true, result: "Failed to authenticate: OAuth session expired" }), "auth"],
    ["usage limit", finished({ is_error: true, result: "You've hit your session limit · resets 6:40pm" }), "limit"],
    ["prose instead of JSON", finished({ result: "Sure! Here it is." }), "invalid-output"],
    ["a crash", { ...finished({}), stdout: "", stderr: "segfault-ish failure", code: 3 }, "provider"],
    ["too large", finished({}, { truncated: true }), "provider"],
    ["refused by Rust", () => Promise.reject('not a model name: "--x"'), "provider"],
  ])("reports %s as %s", async (_name, outcome, kind) => {
    expect(await failure(outcome)).toBe(kind);
  });
});

describe("app AI client", () => {
  it("uses each role's model from Settings and validates the answer", async () => {
    const settings = defaultSettings();
    const models: string[] = [];
    const provider = new AppClaudeProvider(async (call) => (models.push(call.model), finished({ structured_output: { ok: true } })));
    const client = createAppAiClient(settings, { provider });
    const schema = z.object({ ok: z.literal(true) });
    await client.generate({ role: "summaries", system: "s", prompt: "p", schema });
    await client.generate({ role: "planning", system: "s", prompt: "p", schema });
    expect(models).toEqual([settings.roles.summaries.model, settings.roles.planning.model]);
  });

  it("runs Settings' test call through the same client", async () => {
    const provider = new AppClaudeProvider(async () => finished({ structured_output: { ok: true } }));
    expect(await testClaudeCall(provider, "haiku")).toBeGreaterThanOrEqual(0);
    const wrong = new AppClaudeProvider(async () => finished({ structured_output: { ok: "yes" } }));
    expect(await testClaudeCall(wrong, "haiku").catch((e: AiError) => e.kind)).toBe("invalid-output");
  });
});

describe("aiErrorMessage", () => {
  it("has a message for every kind", () => {
    const t = i18n.t.bind(i18n);
    const kinds: AiErrorKind[] = ["auth", "limit", "unavailable", "timeout", "invalid-output", "provider"];
    for (const kind of kinds) {
      const message = aiErrorMessage(t, new AiError(kind, "boom"));
      expect(message).not.toMatch(/^ai\.errors\./);
    }
    expect(aiErrorMessage(t, new AiError("provider", "boom"))).toContain("boom");
    expect(aiErrorMessage(t, "plain failure")).toContain("plain failure");
  });
});
