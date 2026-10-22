import { joinPath, sha256Hex, type Host } from "../host/host.ts";
import type { Usage } from "./types.ts";

export interface CachedAnswer {
  json: unknown;
  usage: Usage;
  costUsd: number | null;
  at: string;
}

export interface AiCache {
  get(key: string): Promise<CachedAnswer | undefined>;
  set(key: string, value: CachedAnswer): Promise<void>;
}

/** Same provider, model, instructions, input and schema → same answer, no new call. */
export function cacheKey(parts: { provider: string; model: string; system: string; prompt: string; jsonSchema: unknown }): string {
  return sha256Hex(JSON.stringify(parts));
}

export class MemoryCache implements AiCache {
  readonly entries = new Map<string, CachedAnswer>();
  async get(key: string) {
    return this.entries.get(key);
  }
  async set(key: string, value: CachedAnswer) {
    this.entries.set(key, value);
  }
}

/** One JSON file per answer, in `dir` (e.g. `<app data>/cache/<sourceHash>/ai`). */
export class FileCache implements AiCache {
  private readonly host: Host;
  private readonly dir: string;

  constructor(host: Host, dir: string) {
    this.host = host;
    this.dir = dir;
  }

  async get(key: string): Promise<CachedAnswer | undefined> {
    try {
      return JSON.parse(await this.host.readFile(joinPath(this.dir, `${key}.json`))) as CachedAnswer;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: CachedAnswer): Promise<void> {
    // The host writes atomically: a crash never leaves a half-written entry behind.
    await this.host.writeFile(joinPath(this.dir, `${key}.json`), JSON.stringify(value));
  }
}
