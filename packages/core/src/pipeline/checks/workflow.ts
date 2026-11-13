// GitHub Actions workflows (#100): "the CI file is valid", checked without running it. The YAML
// parses, the workflow says when it runs (`on`) and what (`jobs`), each job says where
// (`runs-on`) and has steps that each run a command or use an action, and every npm script a step
// runs exists in the package it runs in. Deterministic and offline: the learner's workspace and
// the pipeline call the same function.

import { parse } from "yaml";

type Scripts = (dir: string) => Promise<Record<string, string> | null>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clean = (dir: string) => dir.replace(/^\.\//, "").replace(/\/+$/, "") || ".";

/** npm scripts a shell line runs, with the folder they run in: `npm test`, `npm run build -w apps/api`. */
export function npmScripts(line: string, cwd: string): { dir: string; script: string }[] {
  const found: { dir: string; script: string }[] = [];
  for (const command of line.split(/&&|\|\||;|\n/)) {
    const words = command.trim().split(/\s+/);
    if (words[0] !== "npm") continue;
    const dirs: string[] = [];
    let script: string | undefined;
    let every = false;
    const inCwd = (value: string) => clean(cwd === "." ? value : `${cwd}/${value}`);
    for (let i = 1; i < words.length; i++) {
      const word = words[i]!;
      const value = word.includes("=") ? word.slice(word.indexOf("=") + 1) : words[i + 1];
      if (/^(-w|--workspace)(=|$)/.test(word)) {
        // A workspace given by its folder; a package name (no slash) isn't a folder to look in.
        if (value?.includes("/")) dirs.push(inCwd(value));
        else every = true;
        if (!word.includes("=")) i++;
      } else if (/^--prefix(=|$)/.test(word)) {
        if (value) dirs.push(inCwd(value));
        if (!word.includes("=")) i++;
      } else if (word === "--workspaces" || word === "-ws") every = true;
      else if (script === undefined && ["test", "t", "start"].includes(word)) script = word === "t" ? "test" : word;
      else if (script === undefined && (word === "run" || word === "run-script")) {
        script = words[i + 1];
        i++;
      } else if (!word.startsWith("-") && script === undefined) break; // npm ci, npm install…
    }
    if (script && !every && !script.includes("${{")) for (const dir of dirs.length > 0 ? dirs : [cwd]) found.push({ dir, script });
  }
  return found;
}

/** What's wrong with a workflow file; empty when it's valid. */
export async function workflowProblems(text: string, scripts: Scripts): Promise<string[]> {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (error) {
    return [`it isn't valid YAML: ${(error as Error).message.split("\n")[0]}`];
  }
  if (!isObject(doc)) return ["it isn't a workflow: a workflow is a YAML mapping with `on` and `jobs`"];
  const problems: string[] = [];
  if (doc.on === undefined) problems.push("it doesn't say when it runs: add `on` (push, pull_request…)");
  if (!isObject(doc.jobs) || Object.keys(doc.jobs).length === 0) {
    problems.push("it has no jobs: add `jobs` with at least one job");
    return problems;
  }
  const workflowDir = isObject(doc.defaults) && isObject(doc.defaults.run) ? doc.defaults.run["working-directory"] : undefined;
  for (const [name, job] of Object.entries(doc.jobs)) {
    if (!isObject(job)) {
      problems.push(`job "${name}" isn't a mapping`);
      continue;
    }
    if (typeof job.uses === "string") continue; // a reusable workflow
    if (job["runs-on"] === undefined) problems.push(`job "${name}" doesn't say where it runs: add \`runs-on\` (ubuntu-latest…)`);
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      problems.push(`job "${name}" has no steps`);
      continue;
    }
    const jobDir = isObject(job.defaults) && isObject(job.defaults.run) ? job.defaults.run["working-directory"] : undefined;
    for (const [i, step] of job.steps.entries()) {
      const label = `job "${name}", step ${i + 1}${isObject(step) && typeof step.name === "string" ? ` (${step.name})` : ""}`;
      if (!isObject(step)) {
        problems.push(`${label} isn't a mapping`);
        continue;
      }
      const run = typeof step.run === "string";
      const uses = typeof step.uses === "string";
      if (run === uses) {
        problems.push(`${label} must have either \`run\` (a command) or \`uses\` (an action)`);
        continue;
      }
      if (!run) continue;
      const cwd = clean(String(step["working-directory"] ?? jobDir ?? workflowDir ?? "."));
      for (const { dir, script } of npmScripts(step.run as string, cwd)) {
        const available = await scripts(dir);
        if (available === null) problems.push(`${label} runs \`npm\` in ${dir === "." ? "the project root" : dir}, which has no package.json`);
        else if (!(script in available)) problems.push(`${label} runs the npm script "${script}", which ${dir === "." ? "package.json" : `${dir}/package.json`} doesn't have`);
      }
    }
  }
  return problems;
}

/** The npm scripts of `dir`'s package.json, read through `read`; null when it has none. */
export const scriptsFrom =
  (read: (path: string) => Promise<string>): Scripts =>
  async (dir) => {
    const text = await read(dir === "." ? "package.json" : `${dir}/package.json`).catch(() => null);
    if (text === null) return null;
    try {
      const pkg = JSON.parse(text) as { scripts?: Record<string, string> };
      return pkg.scripts ?? {};
    } catch {
      return null;
    }
  };
