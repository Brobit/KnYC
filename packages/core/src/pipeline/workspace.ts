// Moving the timeline's working copy to a given step, with a clean build (used by stage ⑧).

import { joinPath, type Host } from "../host/host.ts";
import { runCommand, type CheckOutcome, type Scan } from "../sys/knyc-sys.ts";
import { builds, packageCommands, type PackageCommands } from "./packages.ts";

/** tsconfig allows comments and trailing commas. */
const parseTsconfig = (raw: string) => JSON.parse(raw.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")) as { extends?: string; compilerOptions?: Record<string, unknown> };

/**
 * The tsconfig the package's build uses: `tsc -p <file>` / `--project <file>` in its build script,
 * tsconfig.build.json for `nest build` (#96: NestJS builds from src/ into dist/), else tsconfig.json.
 */
async function buildTsconfig(host: Host, root: string): Promise<string> {
  const scripts = await host
    .readFile(joinPath(root, "package.json"))
    .then((raw) => (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {})
    .catch(() => ({}) as Record<string, string>);
  const build = scripts.build ?? "";
  const project = build.match(/\btsc\b[^&|;]*?(?:-p|--project)\s+("?)([^\s"]+)\1/)?.[2];
  if (project) return project.endsWith(".json") ? project : `${project.replace(/\/$/, "")}/tsconfig.json`;
  if (/\bnest\s+build\b/.test(build) && (await host.readFile(joinPath(root, "tsconfig.build.json")).then(() => true, () => false))) return "tsconfig.build.json";
  return "tsconfig.json";
}

/** Where the build writes compiled files ("dist" by default), from the tsconfig the build uses. */
export async function buildOutDir(host: Host, root: string): Promise<{ outDir: string; rootDir: string } | null> {
  try {
    // compilerOptions merged along `extends` (local files only), the build's own config winning.
    let file: string | undefined = await buildTsconfig(host, root);
    const options: Record<string, unknown> = {};
    for (let depth = 0; file && depth < 5; depth++) {
      const json = parseTsconfig(await host.readFile(joinPath(root, file)));
      for (const [key, value] of Object.entries(json.compilerOptions ?? {})) if (!(key in options)) options[key] = value;
      file = json.extends?.startsWith(".") ? json.extends.replace(/^\.\//, "") : undefined;
      if (file && !file.endsWith(".json")) file = `${file}.json`;
    }
    return { outDir: String(options.outDir ?? "dist").replace(/^\.\//, "").replace(/\/$/, ""), rootDir: String(options.rootDir ?? ".").replace(/^\.\//, "").replace(/\/$/, "") || "." };
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
export async function checkoutStep(host: Host, workDir: string, tag: string, scan: Scan, timeoutMs = 5 * 60_000): Promise<StepCheckout> {
  await host.git(workDir, ["checkout", "-q", "-f", tag]);
  await host.git(workDir, ["clean", "-fdq"]);
  const commands = packageCommands(scan);
  for (const { root } of builds(commands)) {
    const dir = root === "." ? workDir : joinPath(workDir, root);
    const layout = await buildOutDir(host, dir);
    if (layout) await host.remove(joinPath(dir, layout.outDir));
  }
  return { tag, build: await buildAll(host, workDir, commands, timeoutMs) };
}

/**
 * Builds every package that has a build (#87), each in its folder, in order; stops at the first
 * that fails. A project with nothing to build passes.
 */
export async function buildAll(host: Host, workDir: string, commands: PackageCommands, timeoutMs = 5 * 60_000): Promise<CheckOutcome> {
  let outcome: CheckOutcome = { status: "pass" };
  for (const { root, command } of builds(commands)) {
    outcome = await runCommand(host, root === "." ? workDir : joinPath(workDir, root), command, { timeoutMs });
    if (outcome.status !== "pass") return outcome;
  }
  return outcome;
}
