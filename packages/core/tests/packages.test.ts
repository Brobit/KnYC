import { describe, expect, it } from "vitest";
import {
  buildOutDir,
  builds,
  compiledPath,
  checkCommand,
  checkoutStep,
  inPackage,
  installs,
  MemoryHost,
  packageCommands,
  packageOf,
  relativeImport,
  runStepChecks,
  runSuiteAtStep,
  suitesOf,
  type Check,
  type CheckCommand,
  type CheckOutcome,
  type Scan,
  type SysRequest,
  type WorkspaceFiles,
} from "../src/index.ts";

const command = (root: string, extra: Partial<Scan["commands"][number]> = {}) => ({ root, install: "npm install", build: "npm run build", test: null, run: null, ...extra });

/** A project with an API and a web app, as separate packages (no workspace). */
const twoPackages = {
  commands: [command("apps/api"), command("apps/web")],
  packages: [
    { root: "apps/api", dependencies: { express: "4" } },
    { root: "apps/web", dependencies: { react: "19" } },
  ],
  testRunners: [
    { runner: "vitest", root: "apps/api" },
    { runner: "vitest", root: "apps/web" },
  ],
} as unknown as Scan;

describe("packages (#87)", () => {
  it("install and build each package, or once at a workspace's root", () => {
    expect(installs(packageCommands(twoPackages))).toEqual([
      { root: "apps/api", command: "npm install" },
      { root: "apps/web", command: "npm install" },
    ]);
    const workspace = {
      commands: [command(".", { build: "npm run build --workspaces" }), command("apps/api"), command("apps/web", { build: null })],
      packages: [{ root: ".", workspaces: true, dependencies: {} }, { root: "apps/api" }, { root: "apps/web" }],
    } as unknown as Scan;
    expect(installs(packageCommands(workspace))).toEqual([{ root: ".", command: "npm install" }]);
    expect(builds(packageCommands(workspace))).toEqual([{ root: ".", command: "npm run build --workspaces" }]);
    // A workspace root without a build script: each package builds itself.
    const noRootBuild = { ...workspace, commands: [command(".", { build: null }), command("apps/api")] } as unknown as Scan;
    expect(builds(packageCommands(noRootBuild))).toEqual([{ root: "apps/api", command: "npm run build" }]);
  });

  it("find a file's package and the paths between packages", () => {
    expect(packageOf([".", "apps/api", "apps/web"], "apps/api/src/app.ts")).toBe("apps/api");
    expect(packageOf([".", "apps/api"], "scripts/seed.ts")).toBe(".");
    expect(inPackage("apps/api", "apps/api/src/app.ts")).toBe("src/app.ts");
    expect(relativeImport(".knyc-checks", "dist/app.js")).toBe("../dist/app.js");
    expect(relativeImport("apps/api/.knyc-checks", "apps/api/dist/app.js")).toBe("../dist/app.js");
    expect(relativeImport("apps/api/.knyc-checks", "packages/shared/dist/ids.js")).toBe("../../../packages/shared/dist/ids.js");
    expect(checkCommand({ root: "apps/api", file: "apps/api/.knyc-checks/s01-1-1.test.mjs" })).toBe("node --test .knyc-checks/s01-1-1.test.mjs");
    expect(checkCommand({ file: ".knyc-checks/s01-1-1.test.mjs" })).toBe("node --test .knyc-checks/s01-1-1.test.mjs");
  });

  it("build every package after a checkout, and run each package's suite in its folder", async () => {
    const host = new MemoryHost({
      files: { "/w/apps/api/tsconfig.json": '{ "compilerOptions": { "outDir": "dist" } }', "/w/apps/api/dist/old.js": "old" },
      sys: (request: SysRequest) => {
        if (request.op !== "run") throw new Error("unexpected");
        if (!request.report) return { status: "pass" };
        const file = request.cwd.endsWith("api") ? "tests/notes.test.ts" : "src/App.test.tsx";
        return { status: "pass", tests: { success: true, passed: 1, failed: 0, skipped: 0, tests: [{ file, name: "works", status: "pass", durationMs: 1 }] } };
      },
    });
    const { build } = await checkoutStep(host, "/w", "p/s01", twoPackages, 1000);
    expect(build.status).toBe("pass");
    expect(host.files.has("/w/apps/api/dist/old.js")).toBe(false);
    const runs = host.sysCalls.map((r) => (r.op === "run" ? `${r.cwd} ${r.command}` : r.op));
    expect(runs).toEqual(["/w/apps/api npm run build", "/w/apps/web npm run build"]);

    const run = await runSuiteAtStep(host, "/w", { stepId: "s01", tag: "p/s01" }, twoPackages, [], "/src", suitesOf(twoPackages), 1000);
    expect([...run.results.keys()]).toEqual(["apps/api/tests/notes.test.ts › works", "apps/web/src/App.test.tsx › works"]);
  });

  it("let the learner's runs install and build per package, each build check with its package", async () => {
    const present = new Set(["apps/web/node_modules"]);
    const files: WorkspaceFiles = {
      read: async () => "",
      write: async () => {},
      remove: async () => {},
      exists: async (path) => present.has(path),
    };
    const calls: string[] = [];
    const run = async (request: CheckCommand): Promise<CheckOutcome> => {
      calls.push(`${request.root} ${request.command}`);
      return request.root === "apps/web" && request.command.includes("build") ? { status: "fail", run: { exitCode: 1, timedOut: false, durationMs: 1, stdout: "", stderr: "TS2304", truncated: false } } : { status: "pass" };
    };
    const buildCheck = (id: string, root: string): Check => ({ schemaVersion: 1, id, stepId: "s01", label: `${root} builds`, origin: "generated", timeoutMs: 1000, spec: { kind: "build", root, command: "npm run build" } });
    const results = await runStepChecks({ checks: [buildCheck("chk-s01-1", "apps/api"), buildCheck("chk-s01-2", "apps/web")], pathId: "p", files, run, commands: twoPackages.commands });
    expect(calls).toEqual(["apps/api npm install", "apps/api npm run build", "apps/web npm run build"]);
    expect(results.map((r) => r.status)).toEqual(["pass", "fail"]);
  });
});

describe("where the build writes (#96)", () => {
  const layout = (files: Record<string, string>) => buildOutDir(new MemoryHost({ files: Object.fromEntries(Object.entries(files).map(([p, c]) => [`/p/${p}`, c])) }), "/p");

  it("reads tsconfig.json for a plain tsc build", async () => {
    expect(await layout({ "package.json": '{"scripts":{"build":"tsc"}}', "tsconfig.json": '{\n  // comment\n "compilerOptions": { "outDir": "./dist", "rootDir": "./src", },\n}' })).toEqual({ outDir: "dist", rootDir: "src" });
  });

  it("follows the build's -p config and its extends (NestJS: tsconfig.build.json moves rootDir to src)", async () => {
    const nest = {
      "tsconfig.json": '{"compilerOptions":{"outDir":"./dist","rootDir":"."}}',
      "tsconfig.build.json": '{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"./src"}}',
    };
    const built = await layout({ ...nest, "package.json": '{"scripts":{"build":"tsc -p tsconfig.build.json"}}' });
    expect(built).toEqual({ outDir: "dist", rootDir: "src" });
    expect(compiledPath("src/health/health.controller.ts", built)).toBe("dist/health/health.controller.js");
    expect(await layout({ ...nest, "package.json": '{"scripts":{"build":"nest build"}}' })).toEqual({ outDir: "dist", rootDir: "src" });
    expect(await layout({ ...nest, "package.json": '{"scripts":{"build":"tsc"}}' })).toEqual({ outDir: "dist", rootDir: "." });
  });

  it("is unknown without a tsconfig", async () => {
    expect(await layout({ "package.json": '{"scripts":{"build":"tsc -p tsconfig.build.json"}}' })).toBeNull();
  });
});
