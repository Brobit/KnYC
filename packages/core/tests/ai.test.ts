import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiClient,
  AiError,
  ClaudeCliProvider,
  claudeArgs,
  estimate,
  extractJson,
  FileCache,
  MemoryCache,
  type AiProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "../src/index.ts";

const fakeClaude = [process.execPath, fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url))];
const request: ProviderRequest = {
  model: "haiku",
  system: "You name programmers.",
  prompt: "Give one name.",
  jsonSchema: { type: "object" },
  timeoutMs: 10_000,
};

describe("ClaudeCliProvider (against a fake claude)", () => {
  afterEach(() => {
    delete process.env.FAKE_CLAUDE_MODE;
    delete process.env.FAKE_CLAUDE_ANSWER;
  });

  it("sends a structured, tool-less call with the prompt on stdin", async () => {
    process.env.FAKE_CLAUDE_ANSWER = JSON.stringify({ name: "Ada" });
    const provider = new ClaudeCliProvider({ command: fakeClaude });
    const res = await provider.complete(request);
    expect(res.json).toEqual({ name: "Ada" });
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 0 });
    expect(res.costUsd).toBe(0.0012);
  });

  it("builds the expected arguments", () => {
    const args = claudeArgs(request);
    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(args[args.indexOf("--model") + 1]).toBe("haiku");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1]!)).toEqual({ type: "object" });
  });

  it("drops the $schema marker, which Claude Code rejects", () => {
    const args = claudeArgs({
      ...request,
      jsonSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" },
    });
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1]!)).toEqual({ type: "object" });
  });

  it("reads JSON from a fenced text answer", async () => {
    process.env.FAKE_CLAUDE_MODE = "fenced-text";
    process.env.FAKE_CLAUDE_ANSWER = JSON.stringify({ name: "Grace" });
    const res = await new ClaudeCliProvider({ command: fakeClaude }).complete(request);
    expect(res.json).toEqual({ name: "Grace" });
  });

  it.each([
    ["auth", "auth"],
    ["limit", "limit"],
    ["crash", "provider"],
    ["prose", "invalid-output"],
  ] as const)("reports %s as an AiError of kind %s", async (mode, kind) => {
    process.env.FAKE_CLAUDE_MODE = mode;
    const error = await new ClaudeCliProvider({ command: fakeClaude }).complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe(kind);
  });

  it("times out", async () => {
    process.env.FAKE_CLAUDE_MODE = "hang";
    const error = await new ClaudeCliProvider({ command: fakeClaude })
      .complete({ ...request, timeoutMs: 500 })
      .catch((e: unknown) => e);
    expect((error as AiError).kind).toBe("timeout");
  });

  it("reports a missing program clearly", async () => {
    const error = await new ClaudeCliProvider({ command: ["definitely-not-claude-knyc"] })
      .complete(request)
      .catch((e: unknown) => e);
    expect((error as AiError).kind).toBe("unavailable");
  });

  it("extracts JSON surrounded by prose", () => {
    expect(extractJson({ result: 'Here: {"a": 1} done' })).toEqual({ a: 1 });
  });
});

/** Returns the scripted answers in order, recording each request. */
class ScriptedProvider implements AiProvider {
  readonly id = "scripted";
  readonly requests: ProviderRequest[] = [];
  private readonly answers: (unknown | Error)[];
  constructor(answers: (unknown | Error)[]) {
    this.answers = answers;
  }
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(req);
    const answer = this.answers.shift();
    if (answer instanceof Error) throw answer;
    return { json: answer, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0.01, durationMs: 1 };
  }
}

const roles = {
  summaries: { providerId: "scripted", model: "small" },
  planning: { providerId: "scripted", model: "big" },
  lessons: { providerId: "scripted", model: "big" },
};
const schema = z.object({ name: z.string().min(1), year: z.number().int() });

describe("AiClient", () => {
  it("returns validated data and uses the role's model", async () => {
    const provider = new ScriptedProvider([{ name: "Ada", year: 1843 }]);
    const client = new AiClient({ providers: [provider], roles });
    const res = await client.generate({ role: "planning", system: "s", prompt: "p", schema });
    expect(res).toMatchObject({ data: { name: "Ada", year: 1843 }, calls: 1, cached: false });
    expect(provider.requests[0]!.model).toBe("big");
    expect(provider.requests[0]!.jsonSchema).toMatchObject({ type: "object", required: ["name", "year"] });
  });

  it("sends the exact schema problems back and retries", async () => {
    const provider = new ScriptedProvider([{ name: "", year: "1843" }, { name: "Ada", year: 1843 }]);
    const client = new AiClient({ providers: [provider], roles });
    const res = await client.generate({ role: "summaries", system: "s", prompt: "Name one.", schema });
    expect(res.calls).toBe(2);
    expect(res.usage.inputTokens).toBe(20);
    const retry = provider.requests[1]!.prompt;
    expect(retry).toContain("Name one.");
    expect(retry).toMatch(/- name: /);
    expect(retry).toMatch(/- year: /);
  });

  it("retries a non-JSON answer but not an auth problem", async () => {
    const recovering = new ScriptedProvider([new AiError("invalid-output", "not JSON"), { name: "Ada", year: 1843 }]);
    const ok = await new AiClient({ providers: [recovering], roles }).generate({ role: "planning", system: "s", prompt: "p", schema });
    expect(ok.calls).toBe(2);

    const auth = new ScriptedProvider([new AiError("auth", "log in")]);
    const error = await new AiClient({ providers: [auth], roles })
      .generate({ role: "planning", system: "s", prompt: "p", schema })
      .catch((e: unknown) => e);
    expect((error as AiError).kind).toBe("auth");
    expect(auth.requests).toHaveLength(1);
  });

  it("gives up after the retries", async () => {
    const provider = new ScriptedProvider([{}, {}, {}]);
    const error = await new AiClient({ providers: [provider], roles })
      .generate({ role: "planning", system: "s", prompt: "p", schema })
      .catch((e: unknown) => e);
    expect((error as AiError).kind).toBe("invalid-output");
    expect(provider.requests).toHaveLength(3);
  });

  it("serves repeated calls from the cache", async () => {
    const provider = new ScriptedProvider([{ name: "Ada", year: 1843 }]);
    const client = new AiClient({ providers: [provider], roles, cache: new MemoryCache() });
    await client.generate({ role: "planning", system: "s", prompt: "p", schema });
    const second = await client.generate({ role: "planning", system: "s", prompt: "p", schema });
    expect(second).toMatchObject({ cached: true, calls: 0, data: { name: "Ada" } });
    expect(provider.requests).toHaveLength(1);
    expect(client.totals.calls).toBe(1);

    // A different prompt is a different question.
    const other = new ScriptedProvider([{ name: "Grace", year: 1952 }]);
    const res = await new AiClient({ providers: [other], roles, cache: new MemoryCache() }).generate({ role: "planning", system: "s", prompt: "q", schema });
    expect(res.cached).toBe(false);
  });

  it("fails clearly when a role points to an unknown provider", async () => {
    const error = await new AiClient({ providers: [], roles })
      .generate({ role: "planning", system: "s", prompt: "p", schema })
      .catch((e: unknown) => e);
    expect((error as AiError).kind).toBe("unavailable");
  });
});

describe("FileCache", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "knyc-cache-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores one JSON file per answer and reads it back", async () => {
    const cache = new FileCache(join(dir, "ai"));
    expect(await cache.get("k")).toBeUndefined();
    const value = { json: { a: 1 }, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: null, at: "2026-10-21T00:00:00.000Z" };
    await cache.set("k", value);
    expect(await cache.get("k")).toEqual(value);
    expect(await readdir(join(dir, "ai"))).toEqual(["k.json"]);
  });
});

describe("estimate", () => {
  it("counts about 4 characters per token, with cost only when pricing is given", () => {
    const calls = [{ input: "x".repeat(4000), expectedOutputTokens: 200 }];
    expect(estimate(calls)).toEqual({ calls: 1, inputTokens: 1000, outputTokens: 200, costUsd: null });
    expect(estimate(calls, { inputPerMTok: 1, outputPerMTok: 5 }).costUsd).toBeCloseTo(0.002);
  });
});
