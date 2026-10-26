// Stage ⑧ (design/02-analysis-pipeline.md): every step gets checks that are proven red → green on
// the reference timeline — the project's own tests first, then generated checks.
//
// Steps are prepared one at a time (design/02 D5): `prepareChecks` maps the project's tests once,
// then `forStep` proves one step's checks, so the learner can start step 1 while later steps are
// still being prepared. `buildChecks` does every step in a row (the CLI).

import type { AiClient } from "../../ai/client.ts";
import { AiError } from "../../ai/types.ts";
import { joinPath, type Host, type HttpRequest } from "../../host/host.ts";
import { checkSources } from "../../learn/lesson.ts";
import { profileFor } from "../../profiles/index.ts";
import type { Check } from "../../schemas/check.ts";

/** The server an HTTP check starts (check schema `server`). */
type HttpCheckServer = Extract<Check["spec"], { kind: "http" }>["server"];
import type { LearningPath, Step } from "../../schemas/learning-path.ts";
import { browserStatus, runHttpCheck, runUiCheck, type Graph, type HttpOutcome, type Scan, type UiOutcome } from "../../sys/knyc-sys.ts";
import { stepOfUnits, type Timeline } from "../timeline.ts";
import { buildUnits, type Units } from "../units.ts";
import { builds, inPackage, packageCommands, packageOf } from "../packages.ts";
import { buildOutDir, checkoutStep, compiledPath } from "../workspace.ts";
import { mapTests, runSuiteAtStep, suitesOf, type SuiteRun, type TestMapping } from "./existing.ts";
import { fragileCheck } from "./audit.ts";
import { goalFromChecks } from "./goal.ts";
import { askForHttpChecks, describeHttpProblem, type HttpCandidate } from "./http.ts";
import { askForUiChecks, describeUiProblem, uiTestModule, type UiCandidate } from "./ui.ts";
import { askForChecks, checkCommand, CHECKS_DIR, describeProblem, relativeImport, runCandidate, type CandidateCheck, type StepContext } from "./generated.ts";

export interface StepChecks {
  stepId: string;
  /** strong: at least one check proven red → green. weak: build only. merged: no tag of its own. */
  strength: "strong" | "weak" | "merged";
  existing: number;
  generated: number;
  aiCalls: number;
  notes: string[];
}

export interface ChecksResult {
  checks: Check[];
  /** Generated check files: path in the working copy → code. */
  files: Map<string, string>;
  path: LearningPath;
  report: StepChecks[];
  discardedTests: TestMapping["discarded"];
}

/** One step's checks, ready for the learner. */
export interface StepChecksResult {
  checks: Check[];
  /** Generated check files: path in the working copy → code. */
  files: Map<string, string>;
  report: StepChecks;
  /** The step with its check ids and strength, prep "checks-ready". */
  step: Step;
}

export interface ChecksPreparation {
  /** Which of the project's tests prove which step (save it to skip the suite runs next time). */
  mapping: TestMapping;
  /** Proves one step's checks. Steps can be prepared in any order, one call at a time. */
  forStep(stepId: string): Promise<StepChecksResult>;
}

export interface ChecksOptions {
  host: Host;
  sourceRoot: string;
  client: AiClient;
  /** Extra AI rounds per step when its checks don't prove the step. Default 2. */
  retries?: number;
  onProgress?: (message: string) => void;
  now?: () => Date;
  /** The test mapping of an earlier run on the same timeline (the suite isn't run again). */
  mapping?: TestMapping;
  /** Rewrite each step's goal from its proven checks (#84). Default true. */
  rewriteGoals?: boolean;
  /** The units the path teaches (a track's, #86); default: every unit of the graph. */
  units?: Units;
  /** UI checks (#89): the folder Chromium is downloaded into. Without it, or without Chromium in
   * it, steps marked "ui" get generated tests. */
  ui?: { browsers: string };
}

export async function prepareChecks(
  path: LearningPath,
  timeline: Timeline,
  graph: Graph,
  scan: Scan,
  options: ChecksOptions,
): Promise<ChecksPreparation> {
  const log = options.onProgress ?? (() => {});
  const { host } = options;
  const workDir = timeline.workDir;
  const git = (...args: string[]) => host.git(workDir, args);
  const tagged = timeline.steps.filter((s) => s.tag);
  const setupTag = `${path.id}/s00`;
  const previousTag = (stepId: string) => {
    const i = tagged.findIndex((s) => s.stepId === stepId);
    return i <= 0 ? setupTag : tagged[i - 1]!.tag!;
  };

  // 1. The project's own tests, each package's suite in its folder (#87).
  const suites = suitesOf(scan);
  /** The suite a test (keyed from the project root) belongs to. */
  const suiteOf = (test: string) => {
    const file = test.split(" › ")[0]!;
    const root = packageOf(suites.map((s) => s.root), file);
    return suites.find((s) => s.root === root) ?? suites[0]!;
  };
  let mapping: TestMapping = options.mapping ?? { byStep: new Map(), discarded: [] };
  if (suites.length > 0 && !options.mapping) {
    const testFiles = graph.files.filter((f) => f.test).map((f) => f.path);
    const runs: SuiteRun[] = [];
    for (const step of [{ stepId: null, tag: setupTag }, ...tagged.map((s) => ({ stepId: s.stepId, tag: s.tag! }))]) {
      runs.push(await runSuiteAtStep(host, workDir, step, scan, testFiles, options.sourceRoot, suites));
      log(`suite at ${step.stepId ?? "s00"}`);
    }
    mapping = mapTests(runs);
  }

  // 2. Generated checks for the steps those tests don't cover.
  const units = options.units ?? buildUnits(graph);
  const stepOf = stepOfUnits(path, units);
  const graphFiles = new Map(graph.files.map((f) => [f.path, f]));
  const profile = profileFor(scan.frameworks.map((f) => f.profileId));

  /** What each existing module exports at step k: names the model must use. */
  const exportsAt = (k: number, sources: string[]) =>
    new Map(
      sources.map((src) => {
        const kept = (id: string) => (stepOf.get(id) ?? Infinity) <= k;
        const symbols = graphFiles.get(src)?.symbols ?? [];
        const names = symbols
          .filter((s) => s.exported && !s.name.includes(".") && (kept(`${src}#${s.name}`) || kept(src)))
          .map((s) => {
            const methods = symbols
              .filter((m) => m.kind === "method" && m.name.startsWith(`${s.name}.`) && !m.name.endsWith(".constructor") && (kept(`${src}#${m.name}`) || kept(src)))
              .map((m) => m.name.slice(s.name.length + 1));
            return `${s.kind} ${s.name}${methods.length ? ` (methods: ${methods.join(", ")})` : ""}`;
          });
        return [src, names] as const;
      }),
    );

  /** Source, at the step, of the local files that the step's changed files import (capped). */
  const contextFor = async (tag: string, before: string, sources: string[]) => {
    const changed = (await git("diff", "--name-only", before, tag, "--", ...sources)).split("\n").filter(Boolean);
    const imported = new Set(
      changed.flatMap((f) => (graphFiles.get(f)?.imports ?? []).map((i) => i.resolved).filter((r): r is string => !!r && sources.includes(r) && !changed.includes(r))),
    );
    const context = new Map<string, string>();
    let budget = 24_000;
    for (const file of imported) {
      const code = await git("show", `${tag}:${file}`);
      if (code.length > budget) continue;
      budget -= code.length;
      context.set(file, code);
    }
    return context;
  };

  // Packages (#87): a generated check lives and runs in its step's package, so that package's
  // dependencies resolve; it imports each module from the build output of the module's package.
  const roots = scan.packages.length > 0 ? scan.packages.map((p) => p.root) : ["."];
  const layouts = new Map<string, Awaited<ReturnType<typeof buildOutDir>>>();
  for (const root of roots) layouts.set(root, await buildOutDir(host, root === "." ? workDir : joinPath(workDir, root)));
  const compiledFromRoot = (src: string) => {
    const root = packageOf(roots, src);
    const compiled = compiledPath(inPackage(root, src), layouts.get(root) ?? null);
    return root === "." ? compiled : `${root}/${compiled}`;
  };
  const stepPackage = (step: Step) => packageOf(roots, step.introduces[0]?.unit.split("#")[0] ?? ".");
  // No .at(): the desktop webview targets ES2020 (older macOS WebKit).
  const last = tagged[tagged.length - 1];

  /** What the check writers get for a step: its diff, what exists, how to import it. */
  async function stepContextAt(step: Step, tag: string) {
    const before = previousTag(step.id);
    const sources = (await git("ls-tree", "-r", "--name-only", tag)).split("\n").filter((f) => graph.files.some((g) => g.path === f && !g.test));
    const root = stepPackage(step);
    const checksDir = root === "." ? CHECKS_DIR : `${root}/${CHECKS_DIR}`;
    const pkg = scan.packages.find((p) => p.root === root) ?? scan.packages[0];
    const ctx: StepContext = {
      step,
      diff: await git("diff", before, tag, "--", ...sources),
      importPaths: new Map(sources.map((src) => [src, relativeImport(checksDir, compiledFromRoot(src))])),
      dependencies: Object.keys(pkg?.dependencies ?? {}),
      exports: exportsAt(path.steps.indexOf(step), sources),
      context: await contextFor(tag, before, sources),
      profile,
    };
    return { ctx, before, root, checksDir };
  }

  /**
   * HTTP checks for a step the planner marked "http" (#88), when the project's server starts at
   * that step: proven red → green against it, and still green at the last step. Null when the
   * step should get generated tests instead.
   */
  async function httpChecksFor(step: Step, tag: string, entry: StepChecks): Promise<{ server: HttpCheckServer; candidates: HttpCandidate[] } | null> {
    const root = stepPackage(step);
    const start = packageCommands(scan).find((c) => c.root === root)?.run ?? undefined;
    if (step.checkStrategy !== "http" || !profile.run || !start) return null;
    // Ready once any path answers: the profile's ready path may only exist from a later step.
    const server: HttpCheckServer = { start, root, port: profile.run.port ?? 3000, readyPath: profile.run.readyPaths[0] ?? "/", portEnv: profile.run.portEnv ?? "PORT" };
    const cwd = root === "." ? workDir : joinPath(workDir, root);
    const send = (requests: HttpRequest[]) => runHttpCheck(host, cwd, server, requests, 30_000);

    await checkoutStep(host, workDir, tag, scan);
    const probe = await send([]);
    if (probe.status !== "pass") {
      entry.notes.push(`the server doesn't start at ${step.id} (${probe.error ?? probe.status}); generated tests instead`);
      return null;
    }

    const { ctx, before } = await stepContextAt(step, tag);
    let problems: string[] = [];
    let accepted: HttpCandidate[] = [];
    for (let attempt = 0; attempt <= (options.retries ?? 2) && accepted.length === 0; attempt++) {
      let answer;
      try {
        answer = await askForHttpChecks(options.client, ctx, problems);
      } catch (error) {
        if (!(error instanceof AiError) || error.kind === "auth" || error.kind === "limit") throw error;
        entry.aiCalls += 1;
        entry.notes.push(`http attempt ${attempt + 1}: ${error.message}`);
        continue;
      }
      entry.aiCalls += 1;
      if (answer.checks.length === 0) break;
      const candidates: HttpCandidate[] = answer.checks.map((c) => ({ label: c.label, requests: c.requests as HttpRequest[] }));
      await checkoutStep(host, workDir, tag, scan);
      const atStep: HttpOutcome[] = [];
      for (const c of candidates) atStep.push(await send(c.requests));
      await checkoutStep(host, workDir, before, scan);
      const beforeStep: (HttpOutcome | null)[] = [];
      for (const [i, c] of candidates.entries()) beforeStep.push(atStep[i]!.status === "pass" ? await send(c.requests) : null);
      problems = [];
      candidates.forEach((c, i) => {
        const problem = describeHttpProblem(c.label, atStep[i]!, beforeStep[i] ?? null);
        if (problem) problems.push(problem);
        else accepted.push(c);
      });
      log(`${step.id} http attempt ${attempt + 1}: ${accepted.length}/${candidates.length} checks proven`);
    }
    if (accepted.length > 0 && last && last.tag !== tag) {
      await checkoutStep(host, workDir, last.tag!, scan);
      const kept: HttpCandidate[] = [];
      for (const c of accepted) {
        if ((await send(c.requests)).status === "pass") kept.push(c);
        else entry.notes.push(`"${c.label}" breaks at the last step; dropped`);
      }
      accepted = kept;
    }
    if (accepted.length === 0) {
      entry.notes.push("no HTTP check proven; generated tests instead");
      return null;
    }
    return { server, candidates: accepted };
  }

  /**
   * UI checks for a step the plan marked "ui" (#89), when the project's frontend starts at that
   * step and Chromium is downloaded: Playwright tests proven red → green against it in headless
   * Chromium, and still green at the last step. Null when the step should get generated tests.
   */
  async function uiChecksFor(step: Step, tag: string, entry: StepChecks): Promise<{ server: HttpCheckServer; candidates: UiCandidate[] } | null> {
    if (step.checkStrategy !== "ui") return null;
    const root = stepPackage(step);
    const start = packageCommands(scan).find((c) => c.root === root)?.run ?? undefined;
    if (!profile.run || !start) {
      entry.notes.push("the frontend has no start script; generated tests instead");
      return null;
    }
    const browsers = options.ui?.browsers;
    if (!browsers || !(await browserStatus(host, browsers).then((s) => s.installed, () => false))) {
      entry.notes.push("Chromium isn't downloaded; generated tests instead");
      return null;
    }
    const server: HttpCheckServer = { start, root, port: profile.run.port ?? 3000, readyPath: profile.run.readyPaths[0] ?? "/", portEnv: profile.run.portEnv ?? "PORT" };
    const cwd = root === "." ? workDir : joinPath(workDir, root);
    const checksDir = root === "." ? CHECKS_DIR : `${root}/${CHECKS_DIR}`;
    const test = async (candidate: UiCandidate) => {
      const file = joinPath(workDir, candidate.file);
      await host.writeFile(file, candidate.code);
      try {
        return await runUiCheck(host, cwd, server, [file], browsers, 60_000);
      } finally {
        await host.remove(file);
      }
    };

    const { ctx, before } = await stepContextAt(step, tag);
    let problems: string[] = [];
    let accepted: UiCandidate[] = [];
    for (let attempt = 0; attempt <= (options.retries ?? 2) && accepted.length === 0; attempt++) {
      let answer;
      try {
        answer = await askForUiChecks(options.client, ctx, problems);
      } catch (error) {
        if (!(error instanceof AiError) || error.kind === "auth" || error.kind === "limit") throw error;
        entry.aiCalls += 1;
        entry.notes.push(`ui attempt ${attempt + 1}: ${error.message}`);
        continue;
      }
      entry.aiCalls += 1;
      if (answer.checks.length === 0) break;
      const candidates: UiCandidate[] = answer.checks.map((c, i) => ({ label: c.label, file: `${checksDir}/${step.id}-ui-${attempt + 1}-${i + 1}.ui.mjs`, code: uiTestModule(c.label, c.body) }));
      await checkoutStep(host, workDir, tag, scan);
      const atStep: UiOutcome[] = [];
      for (const c of candidates) atStep.push(await test(c));
      // Chromium or Node.js missing isn't the model's doing: no retry.
      if (atStep.some((o) => o.status === "unavailable")) {
        entry.notes.push(`UI checks can't run: ${atStep.find((o) => o.status === "unavailable")!.error}; generated tests instead`);
        return null;
      }
      await checkoutStep(host, workDir, before, scan);
      const beforeStep: (UiOutcome | null)[] = [];
      for (const [i, c] of candidates.entries()) beforeStep.push(atStep[i]!.status === "pass" ? await test(c) : null);
      problems = [];
      candidates.forEach((c, i) => {
        const problem = describeUiProblem(c.label, atStep[i]!, beforeStep[i] ?? null);
        if (problem) problems.push(problem);
        else accepted.push(c);
      });
      log(`${step.id} ui attempt ${attempt + 1}: ${accepted.length}/${candidates.length} checks proven`);
    }
    if (accepted.length > 0 && last && last.tag !== tag) {
      await checkoutStep(host, workDir, last.tag!, scan);
      const kept: UiCandidate[] = [];
      for (const c of accepted) {
        if ((await test(c)).status === "pass") kept.push(c);
        else entry.notes.push(`"${c.label}" breaks at the last step; dropped`);
      }
      accepted = kept;
    }
    if (accepted.length === 0) {
      entry.notes.push("no UI check proven; generated tests instead");
      return null;
    }
    return { server, candidates: accepted };
  }

  /** Generated checks proven red → green for one step, and still green at the last step. */
  async function generatedFor(step: Step, tag: string, entry: StepChecks): Promise<CandidateCheck[]> {
    const { ctx, before, root, checksDir } = await stepContextAt(step, tag);

    let problems: string[] = [];
    let accepted: CandidateCheck[] = [];
    for (let attempt = 0; attempt <= (options.retries ?? 2); attempt++) {
      let answer;
      try {
        answer = await askForChecks(options.client, ctx, problems);
      } catch (error) {
        // A slow or failing call costs this step one attempt; a login problem or a usage limit
        // stops everything (retrying would only fail again).
        if (!(error instanceof AiError) || error.kind === "auth" || error.kind === "limit") throw error;
        entry.aiCalls += 1;
        entry.notes.push(`attempt ${attempt + 1}: ${error.message}`);
        log(`${step.id} attempt ${attempt + 1}: AI ${error.kind}`);
        continue;
      }
      entry.aiCalls += 1;
      if (answer.checks.length === 0) {
        entry.notes.push(`no runtime check: ${answer.reasonIfNone ?? "nothing observable at runtime"}`);
        break;
      }
      problems = [];
      // Fragile checks are refused before running: they could pass here and fail for the learner.
      const candidates = answer.checks
        .map((c, i) => ({ ...c, root, file: `${checksDir}/${step.id}-${attempt + 1}-${i + 1}.test.mjs` }))
        .filter((c) => {
          const fragile = fragileCheck(c.code);
          for (const problem of fragile) problems.push(`"${c.label}": ${problem}`);
          return fragile.length === 0;
        });
      if (candidates.length === 0) {
        log(`${step.id} attempt ${attempt + 1}: every check is fragile`);
        continue;
      }

      await checkoutStep(host, workDir, tag, scan);
      const atStep = await Promise.all(candidates.map((c) => runCandidate(host, workDir, c)));
      await checkoutStep(host, workDir, before, scan);
      const beforeStep = await Promise.all(
        candidates.map((c, i) => (atStep[i]!.status === "pass" ? runCandidate(host, workDir, c) : Promise.resolve(null))),
      );

      const good: CandidateCheck[] = [];
      candidates.forEach((c, i) => {
        const problem = describeProblem(c.label, atStep[i]!, beforeStep[i] ?? null);
        if (problem) problems.push(problem);
        else good.push(c);
      });
      log(`${step.id} attempt ${attempt + 1}: ${good.length}/${candidates.length} checks proven`);
      if (good.length > 0) {
        accepted = good;
        break;
      }
    }
    if (accepted.length === 0 && problems.length > 0) entry.notes.push(`no proven check after retries; last problem: ${problems[0]!.split("\n")[0]}`);

    // Generated checks must also pass at the last step (they shouldn't break as the code grows).
    if (accepted.length > 0 && last && last.tag !== tag) {
      await checkoutStep(host, workDir, last.tag!, scan);
      const kept: CandidateCheck[] = [];
      for (const check of accepted) {
        if ((await runCandidate(host, workDir, check)).status === "pass") kept.push(check);
        else entry.notes.push(`"${check.label}" breaks at the last step; dropped`);
      }
      accepted = kept;
    }
    return accepted;
  }

  /**
   * How the original declares what a step introduces: each exported symbol's (and method's) first
   * lines up to its opening brace, never its body. The checks often pass values positionally
   * (`notesRouter(store, 100)`), so only these say what the parameters are called (#84).
   */
  async function declarationsAt(step: Step, tag: string): Promise<string[]> {
    const declarations: string[] = [];
    for (const unit of step.introduces) {
      const [file, symbol] = unit.unit.split("#") as [string, string | undefined];
      const node = graphFiles.get(file);
      const code = node ? await git("show", `${tag}:${file}`).catch(() => null) : null;
      if (!node || code === null) continue;
      const lines = code.split("\n");
      const wanted = node.symbols.filter((s) => (symbol ? s.name === symbol || s.name.startsWith(`${symbol}.`) : s.exported || s.kind === "method"));
      for (const s of wanted) {
        const head = lines.slice(s.startLine - 1, Math.min(s.endLine, s.startLine + 3)).join("\n");
        if (!head.trim()) continue;
        const cut = head.search(/\{\s*$|\{\s*\n|=>/m);
        declarations.push(`${file}: ${(cut > 0 ? head.slice(0, cut) : head).replace(/\s+/g, " ").trim()}`);
      }
    }
    return declarations.slice(0, 40);
  }

  /** The project's own test files (for goals of steps its tests check), read once. */
  let tests: Promise<Map<string, string>> | null = null;
  const projectTests = () =>
    (tests ??= (async () => {
      const files = new Map<string, string>();
      for (const file of graph.files.filter((f) => f.test)) {
        const code = await host.readFile(joinPath(options.sourceRoot, file.path)).catch(() => null);
        if (code !== null) files.set(file.path, code);
      }
      return files;
    })());

  async function forStep(stepId: string): Promise<StepChecksResult> {
    const step = path.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`the path has no step ${stepId}`);
    const at = (options.now ?? (() => new Date()))().toISOString();
    const build = timeline.steps.find((s) => s.stepId === stepId);
    const existing = mapping.byStep.get(stepId) ?? [];
    const entry: StepChecks = { stepId, strength: "weak", existing: existing.length, generated: 0, aiCalls: 0, notes: [] };
    let generated: CandidateCheck[] = [];
    let http: Awaited<ReturnType<typeof httpChecksFor>> = null;
    let ui: Awaited<ReturnType<typeof uiChecksFor>> = null;
    if (build?.mergedInto) {
      entry.strength = "merged";
      entry.notes.push(`doesn't build alone; merged into ${build.mergedInto}`);
    } else if (build?.tag && existing.length === 0) {
      http = await httpChecksFor(step, build.tag, entry);
      if (!http) ui = await uiChecksFor(step, build.tag, entry);
      if (!http && !ui) generated = await generatedFor(step, build.tag, entry);
    }

    // Check documents and the updated step.
    const checks: Check[] = [];
    const files = new Map<string, string>();
    const add = (check: Omit<Check, "schemaVersion" | "id" | "stepId">) => {
      checks.push({ schemaVersion: 1, id: `chk-${step.id}-${checks.length + 1}`, stepId: step.id, ...check });
    };
    const proven = { failsOnPrevious: true, passesOnReference: true, at };

    for (const test of existing) {
      const name = test.split(" › ").slice(1).join(" › ");
      const suite = suiteOf(test);
      add({ label: name, origin: "repo", timeoutMs: 120_000, validation: proven, spec: { kind: "test", root: suite.root, runner: suite.runner as "vitest", command: suite.command, filter: [name], files: [] } });
    }
    for (const check of generated) {
      files.set(check.file, check.code);
      add({ label: check.label, origin: "generated", timeoutMs: 60_000, validation: proven, spec: { kind: "test", root: check.root ?? ".", runner: "other", command: checkCommand(check), filter: [], files: [check.file] } });
    }
    for (const candidate of http?.candidates ?? []) {
      add({ label: candidate.label, origin: "generated", timeoutMs: 60_000, validation: proven, spec: { kind: "http", server: http!.server, requests: candidate.requests as Extract<Check["spec"], { kind: "http" }>["requests"] } });
    }
    for (const candidate of ui?.candidates ?? []) {
      files.set(candidate.file, candidate.code);
      add({ label: candidate.label, origin: "generated", timeoutMs: 90_000, validation: proven, spec: { kind: "ui", server: ui!.server, files: [candidate.file] } });
    }
    entry.generated = generated.length + (http?.candidates.length ?? 0) + (ui?.candidates.length ?? 0);
    if (entry.strength !== "merged") entry.strength = checks.length > 0 ? "strong" : "weak";
    if (entry.strength === "weak") {
      // One build check per package that builds (#87).
      const packages = builds(packageCommands(scan));
      for (const { root, command } of packages) {
        const label = packages.length === 1 ? "The project builds" : `${root === "." ? "The project root" : root} builds`;
        add({ label, origin: "generated", timeoutMs: 300_000, spec: { kind: "build", root, command } });
      }
    }

    // The goal, rewritten from the proven checks so it names their contracts (#84).
    let goal = step.goal;
    // HTTP checks have no code: their requests are what the goal must name.
    const httpSources = (http?.candidates ?? []).map((c) => ({ label: c.label, file: "(HTTP requests)", code: JSON.stringify(c.requests, null, 2) }));
    const sources = options.rewriteGoals === false ? [] : [...checkSources(checks, files, existing.length > 0 ? await projectTests() : new Map()), ...httpSources];
    if (sources.length > 0) {
      try {
        const tag = build?.tag ?? timeline.steps.find((s) => s.stepId === build?.mergedInto)?.tag;
        goal = await goalFromChecks(options.client, step, sources, tag ? await declarationsAt(step, tag) : []);
        entry.aiCalls += 1;
        entry.notes.push("goal rewritten from its checks");
      } catch (error) {
        // A login problem or a usage limit stops everything, as for the checks themselves.
        if (error instanceof AiError && (error.kind === "auth" || error.kind === "limit")) throw error;
        entry.notes.push(`goal kept: ${error instanceof Error ? error.message : String(error)}`);
      }
      log(`${step.id} goal ${goal === step.goal ? "kept" : "rewritten"}`);
    }
    return {
      checks,
      files,
      report: entry,
      step: {
        ...step,
        goal,
        checkIds: checks.map((c) => c.id),
        checkStrength: entry.strength === "strong" ? "strong" : "weak",
        prep: "checks-ready",
      },
    };
  }

  return { mapping, forStep };
}

/** Every step's checks, in path order. */
export async function buildChecks(
  path: LearningPath,
  timeline: Timeline,
  graph: Graph,
  scan: Scan,
  options: ChecksOptions,
): Promise<ChecksResult> {
  const preparation = await prepareChecks(path, timeline, graph, scan, options);
  const results: StepChecksResult[] = [];
  for (const step of path.steps) results.push(await preparation.forStep(step.id));
  return {
    checks: results.flatMap((r) => r.checks),
    files: new Map(results.flatMap((r) => [...r.files])),
    path: { ...path, steps: results.map((r) => r.step) },
    report: results.map((r) => r.report),
    discardedTests: preparation.mapping.discarded,
  };
}

export { mapTests, runSuiteAtStep, suiteCommand } from "./existing.ts";
