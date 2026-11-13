import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deploymentCheck, npmScripts, profileForTrack, workflowProblems } from "../src/index.ts";

const golden = (path: string) => readFileSync(new URL(`../../../fixtures/golden/fullstack-notes/${path}`, import.meta.url), "utf8");

describe("the deployment track's checks (#100)", () => {
  const readyPath = () => "/health";

  it("builds and runs each Dockerfile from the right context, on its HEALTHCHECK path", () => {
    expect(deploymentCheck("apps/api/Dockerfile", "dockerfile", golden("apps/api/Dockerfile"), readyPath)).toEqual({
      label: "apps/api/Dockerfile builds, and the container answers on /api/health",
      spec: { kind: "docker", context: ".", dockerfile: "apps/api/Dockerfile", run: { port: 3000, healthPath: "/api/health" } },
      timeoutMs: 600_000,
    });
    expect(deploymentCheck("apps/web/Dockerfile", "dockerfile", golden("apps/web/Dockerfile"), readyPath)?.spec).toEqual({
      kind: "docker",
      context: ".",
      dockerfile: "apps/web/Dockerfile",
      run: { port: 80, healthPath: "/" },
    });
    // No HEALTHCHECK: the profile's path; no EXPOSE: the image only has to build.
    expect(deploymentCheck("svc/Dockerfile", "dockerfile", "FROM node:22\nEXPOSE 8080\n", readyPath)?.spec).toEqual({ kind: "docker", context: "svc", dockerfile: "svc/Dockerfile", run: { port: 8080, healthPath: "/health" } });
    expect(deploymentCheck("Dockerfile", "dockerfile", "FROM node:22\nRUN npm ci\n", readyPath)?.label).toBe("Dockerfile builds");
  });

  it("brings a compose file up, and judges a workflow", () => {
    expect(deploymentCheck("compose.yaml", "yaml", golden("compose.yaml"), readyPath)?.spec).toEqual({ kind: "compose", file: "compose.yaml" });
    expect(deploymentCheck(".github/workflows/ci.yml", "yaml", golden(".github/workflows/ci.yml"), readyPath)?.spec).toEqual({ kind: "workflow", file: ".github/workflows/ci.yml" });
    expect(deploymentCheck("src/app.ts", "typescript", "", readyPath)).toBeNull();
    expect(profileForTrack(["express", "react"], "deployment").id).toBe("deployment");
  });

  it("finds the golden repo's workflow valid", async () => {
    const pkg = (path: string) => JSON.parse(golden(path)).scripts as Record<string, string>;
    const project = scripts({ ".": pkg("package.json"), "apps/api": pkg("apps/api/package.json"), "apps/web": pkg("apps/web/package.json") });
    expect(await workflowProblems(golden(".github/workflows/ci.yml"), project)).toEqual([]);
  });
});

// The deployment track (#100).

const scripts = (byDir: Record<string, Record<string, string>>) => async (dir: string) => byDir[dir] ?? null;

const WORKFLOW = `name: CI
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build -w apps/api -w apps/web
      - name: Tests
        run: npm test --workspaces
`;

describe("a GitHub Actions workflow (#100)", () => {
  it("finds the npm scripts a step runs, and where", () => {
    expect(npmScripts("npm ci && npm test", ".")).toEqual([{ dir: ".", script: "test" }]);
    expect(npmScripts("npm run build -w apps/api", ".")).toEqual([{ dir: "apps/api", script: "build" }]);
    expect(npmScripts("npm run lint --workspace=apps/web", ".")).toEqual([{ dir: "apps/web", script: "lint" }]);
    expect(npmScripts("npm test --workspaces", ".")).toEqual([]);
    expect(npmScripts("npm start", "apps/api")).toEqual([{ dir: "apps/api", script: "start" }]);
    expect(npmScripts("npm install", ".")).toEqual([]);
  });

  it("is valid with when, where and steps, and scripts the packages have", async () => {
    const project = scripts({ ".": { test: "x" }, "apps/api": { build: "tsc" }, "apps/web": { build: "vite build" } });
    expect(await workflowProblems(WORKFLOW, project)).toEqual([]);
  });

  it("says what is missing or wrong", async () => {
    const project = scripts({ ".": {}, "apps/api": { build: "tsc" } });
    // `npm test --workspaces` runs each workspace's own test: not checked against the root.
    expect(await workflowProblems(WORKFLOW, project)).toEqual(['job "test", step 4 runs `npm` in apps/web, which has no package.json']);
    expect(await workflowProblems(WORKFLOW.replace("npm test --workspaces", "npm test"), project)).toEqual([
      'job "test", step 4 runs `npm` in apps/web, which has no package.json',
      'job "test", step 5 (Tests) runs the npm script "test", which package.json doesn\'t have',
    ]);
    expect(await workflowProblems("jobs:\n  a:\n    steps:\n      - run: echo hi\n        uses: x\n", project)).toEqual([
      "it doesn't say when it runs: add `on` (push, pull_request…)",
      'job "a" doesn\'t say where it runs: add `runs-on` (ubuntu-latest…)',
      'job "a", step 1 must have either `run` (a command) or `uses` (an action)',
    ]);
    expect(await workflowProblems("on: [push\n", project)).toEqual([expect.stringMatching(/^it isn't valid YAML/)]);
  });
});
