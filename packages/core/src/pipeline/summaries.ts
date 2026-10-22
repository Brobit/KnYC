// Stage ⑤ (design/02-analysis-pipeline.md): bottom-up summaries — files, then modules (folders),
// then the project. They keep later prompts small enough for any repo size.

import { sha256Hex } from "../host/host.ts";
import { z } from "zod";
import type { AiCache } from "../ai/cache.ts";
import type { AiClient } from "../ai/client.ts";
import { estimateTokens } from "../ai/estimate.ts";
import { addUsage, emptyUsage, type Usage } from "../ai/types.ts";
import type { GraphFile } from "../sys/knyc-sys.ts";

/** Part of every cache key: bump it when prompts or schemas change. */
export const SUMMARIES_VERSION = 1;

export const SYSTEM = `You are the code analyst of KnYC, an app that teaches developers a codebase by having them rebuild it step by step.
Write plain, precise English for a developer who is new to this project.
Explain what the code does and why it exists, not line by line.
Only describe behavior that is visible in the code you are given. Never invent features.`;

export interface SourceFile {
  path: string;
  /** Already redacted (see redact.ts). */
  content: string;
  /** From the code graph: top-level symbols the summary may name. */
  symbols: Pick<GraphFile["symbols"][number], "name" | "kind">[];
  layer?: number;
}

export interface FileSummary {
  path: string;
  role: string;
  summary: string;
  keySymbols: { name: string; purpose: string }[];
}

export interface ModuleSummary {
  /** Folder, e.g. "src/notes" ("." for the project root). */
  module: string;
  summary: string;
  files: string[];
}

export interface ProjectSummary {
  name: string;
  purpose: string;
  architecture: string;
  entryPoints: string[];
  keyConcepts: string[];
}

export interface Summaries {
  version: number;
  files: FileSummary[];
  modules: ModuleSummary[];
  project: ProjectSummary;
}

export interface StageStats {
  usage: Usage;
  calls: number;
  /** Files served from the per-file cache. */
  cachedFiles: number;
}

const newStats = (): StageStats => ({ usage: emptyUsage(), calls: 0, cachedFiles: 0 });

function addResult(stats: StageStats, result: { usage: Usage; calls: number }) {
  stats.usage = addUsage(stats.usage, result.usage);
  stats.calls += result.calls;
}

/**
 * Consecutive groups of files under a token budget. Order is kept (callers pass files in layer
 * order, so related files tend to share a batch). A file over the budget gets its own batch.
 */
export function batchFiles(files: SourceFile[], maxTokens = 12_000, maxFiles = 8): SourceFile[][] {
  return batchBySize(files, (file) => estimateTokens(file.content), maxTokens, maxFiles);
}

/** The batching rule of `batchFiles`, for any items with a token size (estimates use file sizes). */
export function batchBySize<T>(items: T[], size: (item: T) => number, maxTokens = 12_000, maxFiles = 8): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  for (const item of items) {
    const itemTokens = size(item);
    if (current.length > 0 && (tokens + itemTokens > maxTokens || current.length >= maxFiles)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(item);
    tokens += itemTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function fileKey(file: SourceFile, cacheTag: string): string {
  return sha256Hex(JSON.stringify({ v: SUMMARIES_VERSION, cacheTag, path: file.path, content: file.content, symbols: file.symbols }));
}

/** The answer schema for one batch: exactly these paths, key symbols taken from each file. */
export function fileBatchSchema(batch: SourceFile[]) {
  const paths = batch.map((f) => f.path) as [string, ...string[]];
  const symbolsOf = new Map(batch.map((f) => [f.path, new Set(f.symbols.map((s) => s.name))]));
  return z
    .object({
      files: z.array(
        z.object({
          path: z.enum(paths),
          role: z.string().min(3).max(80).describe("What this file is, in a few words: 'in-memory notes store'"),
          summary: z.string().min(20).max(600).describe("One or two sentences: what it does and why it exists"),
          keySymbols: z
            .array(z.object({ name: z.string(), purpose: z.string().min(3).max(200) }))
            .max(8)
            .describe("The most important symbols, using names from the file's symbol list"),
        }),
      ),
    })
    .superRefine((answer, ctx) => {
      const seen = answer.files.map((f) => f.path);
      for (const path of paths) {
        if (!seen.includes(path)) ctx.addIssue({ code: "custom", path: ["files"], message: `missing a summary for ${path}` });
      }
      seen.forEach((path, i) => {
        if (seen.indexOf(path) !== i) ctx.addIssue({ code: "custom", path: ["files", i, "path"], message: `${path} is summarized twice` });
      });
      answer.files.forEach((file, i) => {
        const known = symbolsOf.get(file.path) ?? new Set();
        file.keySymbols.forEach((symbol, j) => {
          if (!known.has(symbol.name)) {
            const list = [...known].join(", ") || "none";
            ctx.addIssue({
              code: "custom",
              path: ["files", i, "keySymbols", j, "name"],
              message: `${symbol.name} is not a symbol of ${file.path} (its symbols: ${list})`,
            });
          }
        });
      });
    });
}

function fileBatchPrompt(batch: SourceFile[]): string {
  const sections = batch.map((file) => {
    const symbols = file.symbols.map((s) => `${s.name} (${s.kind})`).join(", ") || "none (top-level code only)";
    const ext = file.path.split(".").pop() ?? "";
    return `### ${file.path}${file.layer === undefined ? "" : ` (dependency layer ${file.layer})`}
Symbols: ${symbols}
\`\`\`${ext}
${file.content}
\`\`\``;
  });
  return `Summarize each of these ${batch.length} source files. Return one entry per file, using its exact path.
For keySymbols, only use names from that file's "Symbols" list (pick at most the 8 that matter most; none if the list is empty).

${sections.join("\n\n")}`;
}

export interface SummarizeOptions {
  cache?: AiCache;
  /** Identifies provider + model in cache keys, e.g. "claude-cli:haiku". */
  cacheTag: string;
  maxBatchTokens?: number;
  onProgress?: (done: number, total: number) => void;
  /** Reports each retry and the problems sent back to the model. */
  onRetry?: (stage: "files" | "modules" | "project", problems: string[]) => void;
}

/** File summaries, served from the per-file cache when the file hasn't changed. */
export async function summarizeFiles(client: AiClient, files: SourceFile[], options: SummarizeOptions) {
  const stats = newStats();
  const byPath = new Map<string, FileSummary>();
  const todo: SourceFile[] = [];
  for (const file of files) {
    const hit = await options.cache?.get(fileKey(file, options.cacheTag));
    if (hit) {
      byPath.set(file.path, hit.json as FileSummary);
      stats.cachedFiles += 1;
    } else {
      todo.push(file);
    }
  }

  let done = stats.cachedFiles;
  for (const batch of batchFiles(todo, options.maxBatchTokens)) {
    const result = await client.generate({
      role: "summaries",
      system: SYSTEM,
      prompt: fileBatchPrompt(batch),
      schema: fileBatchSchema(batch),
      onRetry: (_attempt, problems) => options.onRetry?.("files", problems),
    });
    addResult(stats, result);
    for (const summary of result.data.files) {
      byPath.set(summary.path, summary);
      const file = batch.find((f) => f.path === summary.path)!;
      await options.cache?.set(fileKey(file, options.cacheTag), {
        json: summary,
        usage: emptyUsage(),
        costUsd: null,
        at: new Date().toISOString(),
      });
    }
    done += batch.length;
    options.onProgress?.(done, files.length);
  }

  return { summaries: files.map((f) => byPath.get(f.path)!), stats };
}

export function moduleOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "." : path.slice(0, slash);
}

/** Module (folder) summaries, from the file summaries only. */
export async function summarizeModules(client: AiClient, files: FileSummary[], options: Pick<SummarizeOptions, "onRetry"> = {}) {
  const stats = newStats();
  const groups = new Map<string, FileSummary[]>();
  for (const file of files) groups.set(moduleOf(file.path), [...(groups.get(moduleOf(file.path)) ?? []), file]);
  const modules = [...groups.keys()].sort() as [string, ...string[]];

  const schema = z
    .object({ modules: z.array(z.object({ module: z.enum(modules), summary: z.string().min(20).max(600) })) })
    .superRefine((answer, ctx) => {
      const seen = answer.modules.map((m) => m.module);
      for (const module of modules) {
        if (!seen.includes(module)) ctx.addIssue({ code: "custom", path: ["modules"], message: `missing a summary for ${module}` });
      }
    });
  const prompt = `Summarize each folder of this project in one or two sentences: what it is responsible for, as a whole.

${modules
  .map((m) => `### ${m}\n${groups.get(m)!.map((f) => `- ${f.path}: ${f.role}. ${f.summary}`).join("\n")}`)
  .join("\n\n")}`;

  const result = await client.generate({
    role: "summaries",
    system: SYSTEM,
    prompt,
    schema,
    onRetry: (_attempt, problems) => options.onRetry?.("modules", problems),
  });
  addResult(stats, result);
  const summaries: ModuleSummary[] = modules.map((module) => ({
    module,
    summary: result.data.modules.find((m) => m.module === module)!.summary,
    files: groups.get(module)!.map((f) => f.path),
  }));
  return { summaries, stats };
}

export interface ProjectFacts {
  name: string;
  languages: string[];
  frameworks: string[];
  /** File paths per layer, leaves first (from the graph). */
  layers: string[][];
  /** Source files nothing else imports (from the graph): known exactly, so not asked to the AI. */
  entryPoints: string[];
}

/** The project overview, from module summaries and the static facts. */
export async function summarizeProject(
  client: AiClient,
  facts: ProjectFacts,
  modules: ModuleSummary[],
  options: Pick<SummarizeOptions, "onRetry"> = {},
) {
  const stats = newStats();
  const schema = z.object({
    name: z.string().min(1).max(80),
    purpose: z.string().min(20).max(600).describe("What the project is for, in one or two sentences"),
    architecture: z.string().min(20).max(1200).describe("How the parts fit together, from entry point to leaves"),
    keyConcepts: z.array(z.string().min(2).max(60)).min(1).max(10).describe("Ideas a learner meets while rebuilding it"),
  });
  const prompt = `Write the overview of this project.

Name: ${facts.name}
Languages: ${facts.languages.join(", ") || "unknown"}
Frameworks: ${facts.frameworks.join(", ") || "none detected"}
Entry points: ${facts.entryPoints.join(", ") || "none found"}

Dependency layers (leaves first, entry points last):
${facts.layers.map((layer, i) => `${i}. ${layer.join(", ")}`).join("\n")}

Folders:
${modules.map((m) => `- ${m.module}: ${m.summary}`).join("\n")}`;

  const result = await client.generate({
    role: "summaries",
    system: SYSTEM,
    prompt,
    schema,
    onRetry: (_attempt, problems) => options.onRetry?.("project", problems),
  });
  addResult(stats, result);
  return { summary: { ...result.data, entryPoints: facts.entryPoints } as ProjectSummary, stats };
}

/** Runs all three levels and adds up their stats. */
export async function summarize(
  client: AiClient,
  files: SourceFile[],
  facts: ProjectFacts,
  options: SummarizeOptions,
): Promise<{ summaries: Summaries; stats: StageStats }> {
  const fileStage = await summarizeFiles(client, files, options);
  const moduleStage = await summarizeModules(client, fileStage.summaries, options);
  const projectStage = await summarizeProject(client, facts, moduleStage.summaries, options);
  const stats = newStats();
  for (const stage of [fileStage.stats, moduleStage.stats, projectStage.stats]) {
    addResult(stats, stage);
    stats.cachedFiles += stage.cachedFiles;
  }
  return {
    summaries: {
      version: SUMMARIES_VERSION,
      files: fileStage.summaries,
      modules: moduleStage.summaries,
      project: projectStage.summary,
    },
    stats,
  };
}
