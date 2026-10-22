import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AiClient,
  batchFiles,
  fileBatchSchema,
  graphProject,
  loadSourceFiles,
  MemoryCache,
  projectFacts,
  REDACTED,
  redact,
  scanProject,
  summarize,
  summarizeFiles,
  type AiProvider,
  type ProviderRequest,
  type ProviderResponse,
  type SourceFile,
} from "../src/index.ts";
import { findKnycSys, NodeHost } from "../src/node.ts";

/** Answers like a well-behaved model: one summary per "### path" section of the prompt. */
class EchoProvider implements AiProvider {
  readonly id = "echo";
  readonly prompts: string[] = [];
  /** Optional one-off answers, used before the echo behavior. */
  readonly queued: unknown[] = [];

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.prompts.push(req.prompt);
    const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const queued = this.queued.shift();
    if (queued !== undefined) return { json: queued, usage, costUsd: 0, durationMs: 1 };

    const sections = [...req.prompt.matchAll(/^### (\S+)(?:.*)\n(?:Symbols: (.*))?/gm)];
    if (req.prompt.startsWith("Summarize each of these")) {
      const files = sections.map(([, path, symbols]) => ({
        path,
        role: `role of ${path}`,
        summary: `This file ${path} does one clear thing for the app.`,
        keySymbols: (symbols ?? "")
          .split(", ")
          .filter((s) => s && !s.startsWith("none"))
          .slice(0, 1)
          .map((s) => ({ name: s.split(" ")[0], purpose: "main export" })),
      }));
      return { json: { files }, usage, costUsd: 0, durationMs: 1 };
    }
    if (req.prompt.startsWith("Summarize each folder")) {
      return { json: { modules: sections.map(([, module]) => ({ module, summary: `Folder ${module} groups related code.` })) }, usage, costUsd: 0, durationMs: 1 };
    }
    return {
      json: { name: "demo", purpose: "A demo project for the tests.", architecture: "Entry point calls the store through routes.", keyConcepts: ["routing"] },
      usage,
      costUsd: 0,
      durationMs: 1,
    };
  }
}

const roles = {
  summaries: { providerId: "echo", model: "m" },
  planning: { providerId: "echo", model: "m" },
  lessons: { providerId: "echo", model: "m" },
};

const file = (path: string, content: string, symbols: string[] = []): SourceFile => ({
  path,
  content,
  symbols: symbols.map((name) => ({ name, kind: "function" })),
});

describe("redact", () => {
  it("replaces flagged lines, keeping indentation and line count", () => {
    const content = "const a = 1;\n  const key = 'AKIA…';\nconst b = 2;\n";
    const out = redact(content, [2]);
    expect(out.split("\n")).toHaveLength(4);
    expect(out.split("\n")[1]).toBe(`  ${REDACTED}`);
    expect(out).not.toContain("AKIA");
    expect(redact(content, [])).toBe(content);
  });
});

describe("batchFiles", () => {
  it("keeps order, respects the budget and the file limit", () => {
    const files = ["a", "b", "c", "d"].map((p) => file(p, "x".repeat(4000))); // ~1000 tokens each
    expect(batchFiles(files, 2500).map((b) => b.map((f) => f.path))).toEqual([["a", "b"], ["c", "d"]]);
    expect(batchFiles(files, 100_000, 3).map((b) => b.length)).toEqual([3, 1]);
  });

  it("gives an oversized file its own batch", () => {
    const files = [file("small", "x"), file("huge", "x".repeat(100_000)), file("small2", "x")];
    expect(batchFiles(files, 1000).map((b) => b.map((f) => f.path))).toEqual([["small"], ["huge"], ["small2"]]);
  });
});

describe("fileBatchSchema", () => {
  const batch = [file("src/a.ts", "", ["createApp"]), file("src/b.ts", "", [])];
  const ok = (path: string, keySymbols: { name: string; purpose: string }[] = []) => ({
    path,
    role: "a role",
    summary: "A summary that is long enough.",
    keySymbols,
  });

  it("accepts one summary per file with real symbols", () => {
    const answer = { files: [ok("src/a.ts", [{ name: "createApp", purpose: "builds the app" }]), ok("src/b.ts")] };
    expect(fileBatchSchema(batch).safeParse(answer).success).toBe(true);
  });

  it("names missing, duplicated and invented things precisely", () => {
    const answer = { files: [ok("src/a.ts", [{ name: "makeApp", purpose: "builds the app" }]), ok("src/a.ts")] };
    const messages = fileBatchSchema(batch).safeParse(answer).error!.issues.map((i) => i.message);
    expect(messages).toContain("missing a summary for src/b.ts");
    expect(messages).toContain("src/a.ts is summarized twice");
    expect(messages).toContain("makeApp is not a symbol of src/a.ts (its symbols: createApp)");
  });
});

describe("summarizeFiles", () => {
  const files = [file("src/a.ts", "export const a = 1;", ["a"]), file("src/b.ts", "export const b = 2;", ["b"])];

  it("summarizes in batches and caches per file", async () => {
    const provider = new EchoProvider();
    const client = new AiClient({ providers: [provider], roles });
    const cache = new MemoryCache();

    const first = await summarizeFiles(client, files, { cache, cacheTag: "echo:m" });
    expect(first.summaries.map((s) => s.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(first.summaries[0]!.keySymbols).toEqual([{ name: "a", purpose: "main export" }]);
    expect(first.stats).toMatchObject({ calls: 1, cachedFiles: 0 });

    const again = await summarizeFiles(client, files, { cache, cacheTag: "echo:m" });
    expect(again.stats).toMatchObject({ calls: 0, cachedFiles: 2 });

    // Only the changed file is sent again.
    const changed = [files[0]!, { ...files[1]!, content: "export const b = 3;" }];
    const third = await summarizeFiles(client, changed, { cache, cacheTag: "echo:m" });
    expect(third.stats).toMatchObject({ calls: 1, cachedFiles: 1 });
    expect(provider.prompts.at(-1)).toContain("### src/b.ts");
    expect(provider.prompts.at(-1)).not.toContain("### src/a.ts");

    // Another model is another cache.
    const other = await summarizeFiles(client, files, { cache, cacheTag: "echo:other" });
    expect(other.stats.cachedFiles).toBe(0);
  });

  it("sends invented symbols back to the model", async () => {
    const provider = new EchoProvider();
    provider.queued.push({
      files: [
        { path: "src/a.ts", role: "a role", summary: "A summary that is long enough.", keySymbols: [{ name: "ghost", purpose: "x x x" }] },
        { path: "src/b.ts", role: "b role", summary: "A summary that is long enough.", keySymbols: [] },
      ],
    });
    const client = new AiClient({ providers: [provider], roles });
    const result = await summarizeFiles(client, files, { cacheTag: "echo:m" });
    expect(result.stats.calls).toBe(2);
    expect(provider.prompts[1]).toContain("ghost is not a symbol of src/a.ts (its symbols: a)");
    expect(result.summaries[0]!.keySymbols[0]!.name).toBe("a");
  });
});

describe("summarize (all levels)", () => {
  it("produces files, modules and a project overview", async () => {
    const client = new AiClient({ providers: [new EchoProvider()], roles });
    const files = [
      file("src/notes/store.ts", "export class Store {}", ["Store"]),
      file("src/app.ts", "export const app = 1;", ["app"]),
      file("src/server.ts", "app.listen(3000);"),
    ];
    const facts = { name: "demo", languages: ["typescript"], frameworks: ["express 5.3.0"], layers: [["src/notes/store.ts"], ["src/app.ts"], ["src/server.ts"]], entryPoints: ["src/server.ts"] };
    const { summaries, stats } = await summarize(client, files, facts, { cacheTag: "echo:m" });

    expect(summaries.files).toHaveLength(3);
    expect(summaries.modules.map((m) => m.module)).toEqual(["src", "src/notes"]);
    expect(summaries.modules[0]!.files).toEqual(["src/app.ts", "src/server.ts"]);
    expect(summaries.project.entryPoints).toEqual(["src/server.ts"]);
    expect(stats.calls).toBe(3);
  });
});

const knycSys = findKnycSys();
const host = new NodeHost();
const golden = (name: string) => fileURLToPath(new URL(`../../../fixtures/golden/${name}`, import.meta.url));

describe.skipIf(!knycSys)("with the real knyc-sys binary", () => {
  it("loads express-shop's source files in layer order, without tests", async () => {
    const root = golden("express-shop");
    const [scan, graph] = await Promise.all([scanProject(host, root), graphProject(host, root)]);
    const files = await loadSourceFiles(host, root, scan, graph);

    expect(files.length).toBe(graph.layers.flat().length);
    expect(files.every((f) => f.path.startsWith("src/"))).toBe(true);
    expect(files.at(-1)!.path).toBe("src/server.ts");
    expect(files.find((f) => f.path === "src/orders/orders.service.ts")!.symbols.map((s) => s.name)).toContain("OrdersService.checkout");
    const facts = projectFacts("express-shop", scan, graph);
    expect(facts.frameworks).toEqual(["express 5.3.0"]);
    // Only the server: app.ts is imported by it, and test imports don't count.
    expect(facts.entryPoints).toEqual(["src/server.ts"]);
  });
});

describe("onRetry", () => {
  it("reports the stage and the problems sent back", async () => {
    const provider = new EchoProvider();
    provider.queued.push({ files: [] });
    const client = new AiClient({ providers: [provider], roles });
    const retries: [string, string[]][] = [];
    await summarizeFiles(client, [file("src/a.ts", "export const a = 1;", ["a"])], {
      cacheTag: "echo:m",
      onRetry: (stage, problems) => retries.push([stage, problems]),
    });
    expect(retries).toEqual([["files", ["files: missing a summary for src/a.ts"]]]);
  });
});
