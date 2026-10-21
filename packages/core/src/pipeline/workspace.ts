// Moving the timeline's working copy to a given step, with a clean build (used by stage ⑧).

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { runCommand, type CheckOutcome, type Scan } from "../sys/knyc-sys.ts";
import { git } from "./timeline.ts";

/** Where the build writes compiled files ("dist" by default), from tsconfig.json. */
export async function buildOutDir(root: string): Promise<{ outDir: string; rootDir: string } | null> {
  try {
    // tsconfig allows comments and trailing commas.
    const raw = await readFile(join(root, "tsconfig.json"), "utf8");
    const json = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
    const options = json.compilerOptions ?? {};
    return { outDir: String(options.outDir ?? "dist").replace(/^\.\//, ""), rootDir: String(options.rootDir ?? ".").replace(/^\.\//, "") };
  } catch {
    return null;
  }
}

/** "src/notes/notes.store.ts" → "dist/notes/notes.store.js" (what tests import after a build). */
export function compiledPath(source: string, layout: { outDir: string; rootDir: string } | null): string {
  if (!layout) return source;
  const prefix = layout.rootDir === "." ? "" : `${layout.rootDir}/`;
  const inside = source.startsWith(prefix) ? source.slice(prefix.length) : source;
  return `${layout.outDir}/${inside}`.replace(/\.(ts|tsx|mts|cts)$/, (ext) => ({ ".ts": ".js", ".tsx": ".js", ".mts": ".mjs", ".cts": ".cjs" })[ext]!);
}

export interface StepCheckout {
  tag: string;
  build: CheckOutcome;
}

/**
 * Checks out `tag` in the working copy and builds it from scratch: untracked files (copied tests,
 * checks) are removed and the build output is deleted first, so nothing from another step leaks in.
 */
export async function checkoutStep(workDir: string, tag: string, scan: Scan, timeoutMs = 5 * 60_000): Promise<StepCheckout> {
  await git(workDir, "checkout", "-q", "-f", tag);
  await git(workDir, "clean", "-fdq");
  const layout = await buildOutDir(workDir);
  if (layout) await rm(join(workDir, layout.outDir), { recursive: true, force: true });
  const command = scan.commands[0]?.build;
  const build = command
    ? await runCommand(workDir, command, { timeoutMs })
    : ({ status: "pass" } as CheckOutcome);
  return { tag, build };
}
