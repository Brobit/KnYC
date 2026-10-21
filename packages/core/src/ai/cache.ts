import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
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
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async get(key: string): Promise<CachedAnswer | undefined> {
    try {
      return JSON.parse(await readFile(join(this.dir, `${key}.json`), "utf8")) as CachedAnswer;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: CachedAnswer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    // Write then rename, so a crash never leaves a half-written entry behind.
    const tmp = join(this.dir, `${key}.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, join(this.dir, `${key}.json`));
  }
}
