import type { z } from "zod";
import { formatIssues, jsonSchemaFor } from "../schemas/documents.ts";
import { cacheKey, type AiCache } from "./cache.ts";
import { addUsage, AiError, emptyUsage, type AiProvider, type Usage } from "./types.ts";

export interface GenerateRequest<S extends z.ZodType> {
  /** Which configured role answers: settings.roles.summaries / planning / lessons. */
  role: "summaries" | "planning" | "lessons";
  system: string;
  prompt: string;
  schema: S;
  /** Extra attempts when the answer doesn't match the schema. Default 2. */
  retries?: number;
  timeoutMs?: number;
}

export interface GenerateResult<T> {
  data: T;
  usage: Usage;
  costUsd: number | null;
  /** Provider calls made (0 when served from the cache). */
  calls: number;
  cached: boolean;
}

export interface AiClientOptions {
  providers: AiProvider[];
  /** settings.roles: which provider and model each role uses. */
  roles: Record<GenerateRequest<z.ZodType>["role"], { providerId: string; model: string }>;
  cache?: AiCache;
}

/**
 * Typed AI calls: the answer is validated against a Zod schema. When it doesn't match, the
 * exact problems are sent back so the model can fix them (design/02 ⑥ "max 3 retries").
 */
export class AiClient {
  readonly totals = { usage: emptyUsage(), costUsd: 0, calls: 0 };

  private readonly options: AiClientOptions;

  constructor(options: AiClientOptions) {
    this.options = options;
  }

  async generate<S extends z.ZodType>(request: GenerateRequest<S>): Promise<GenerateResult<z.infer<S>>> {
    const role = this.options.roles[request.role];
    const provider = this.options.providers.find((p) => p.id === role.providerId);
    if (!provider) throw new AiError("unavailable", `no provider "${role.providerId}" for role ${request.role}`);

    const jsonSchema = jsonSchemaFor(request.schema);
    const key = cacheKey({ provider: provider.id, model: role.model, system: request.system, prompt: request.prompt, jsonSchema });
    const hit = await this.options.cache?.get(key);
    if (hit) {
      const parsed = request.schema.safeParse(hit.json);
      if (parsed.success) {
        return { data: parsed.data, usage: emptyUsage(), costUsd: 0, calls: 0, cached: true };
      }
    }

    let usage = emptyUsage();
    let costUsd: number | null = 0;
    let prompt = request.prompt;
    const attempts = 1 + (request.retries ?? 2);
    let lastProblems: string[] = [];

    for (let attempt = 1; attempt <= attempts; attempt++) {
      let json: unknown;
      try {
        const response = await provider.complete({
          model: role.model,
          system: request.system,
          prompt,
          jsonSchema,
          timeoutMs: request.timeoutMs ?? 5 * 60_000,
        });
        usage = addUsage(usage, response.usage);
        costUsd = costUsd === null || response.costUsd === null ? null : costUsd + response.costUsd;
        this.record(response.usage, response.costUsd);
        json = response.json;
      } catch (error) {
        // A non-JSON answer is a fixable mistake; anything else (auth, timeout…) stops here.
        if (!(error instanceof AiError && error.kind === "invalid-output")) throw error;
        lastProblems = ["the answer must be a single JSON value matching the schema"];
        prompt = retryPrompt(request.prompt, lastProblems);
        continue;
      }

      const parsed = request.schema.safeParse(json);
      if (parsed.success) {
        await this.options.cache?.set(key, { json, usage, costUsd, at: new Date().toISOString() });
        return { data: parsed.data, usage, costUsd, calls: attempt, cached: false };
      }
      lastProblems = formatIssues(parsed.error);
      prompt = retryPrompt(request.prompt, lastProblems);
    }

    throw new AiError("invalid-output", `no valid answer after ${attempts} attempts`, { problems: lastProblems });
  }

  private record(usage: Usage, costUsd: number | null) {
    this.totals.usage = addUsage(this.totals.usage, usage);
    this.totals.costUsd += costUsd ?? 0;
    this.totals.calls += 1;
  }
}

function retryPrompt(original: string, problems: string[]): string {
  return `${original}

---
Your previous answer did not match the required JSON schema:
${problems.map((p) => `- ${p}`).join("\n")}
Answer again with corrected JSON only.`;
}
