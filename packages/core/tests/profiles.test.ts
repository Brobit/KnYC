import { describe, expect, it } from "vitest";
import graphFixture from "./fixtures/graphs/express-notes.json";
import planFixture from "./fixtures/plans/express-notes.standard.json";
import summariesFixture from "./fixtures/summaries/express-notes.json";
import {
  buildUnits,
  checksPrompt,
  frameworkLabel,
  generic,
  globToRegExp,
  graphSchema,
  isFrontendFramework,
  learningPath,
  planPrompt,
  profileFor,
  PROFILES,
  stepContext,
  trackOf,
  type Summaries,
} from "../src/index.ts";

const express = profileFor(["express 4.21.2"]);

describe("profiles", () => {
  it("are found by the scan's framework id, with a generic one for the rest", () => {
    expect(express.id).toBe("express");
    expect(profileFor(["koa"]).id).toBe("generic");
    expect(profileFor([])).toBe(generic);
    expect(frameworkLabel("express")).toBe("Express");
    expect(frameworkLabel("koa")).toBe("Koa");
  });

  it("are complete and unique", () => {
    const ids = [...PROFILES, generic].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const profile of [...PROFILES, generic]) {
      expect(profile.buildOrder.length).toBeGreaterThan(0);
      expect(profile.check.hints.length).toBeGreaterThan(0);
      expect(profile.trackRules.length).toBeGreaterThan(0);
      for (const rule of profile.trackRules) expect(() => globToRegExp(rule.glob)).not.toThrow();
    }
  });

  it("know which frameworks are frontends (the scan's ids)", () => {
    expect(isFrontendFramework("nextjs")).toBe(true);
    expect(isFrontendFramework("react")).toBe(true);
    expect(isFrontendFramework("express")).toBe(false);
  });
});

describe("track rules", () => {
  it("match globs within and across folders", () => {
    expect(globToRegExp("*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("*.ts").test("src/a.ts")).toBe(false);
    expect(globToRegExp("**/*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("**/*.ts").test("src/notes/a.ts")).toBe(true);
    expect(globToRegExp("**/prisma/**").test("apps/api/prisma/schema.prisma")).toBe(true);
    expect(globToRegExp("{a,b}.json").test("b.json")).toBe(true);
    expect(globToRegExp("tsconfig*.json").test("tsconfig.build.json")).toBe(true);
    // Wildcards inside alternatives (#96: vitest.config.ts and tsconfig.build.json were "backend").
    expect(globToRegExp("{vitest.config.*,tsconfig*.json}").test("vitest.config.ts")).toBe(true);
    expect(globToRegExp("{vitest.config.*,tsconfig*.json}").test("tsconfig.build.json")).toBe(true);
    expect(globToRegExp("{a?.json,b}").test("ab.json")).toBe(true);
    expect(globToRegExp("{vitest.config.*}").test("src/vitest.config.ts")).toBe(false);
  });

  it("put an Express project's files in their tracks", () => {
    const tracks = Object.fromEntries(
      [
        "src/notes/notes.routes.ts",
        "src/app.ts",
        "package.json",
        "tsconfig.json",
        "prisma/schema.prisma",
        "db/migrations/001_init.sql",
        "Dockerfile",
        "docker-compose.yml",
        ".github/workflows/ci.yml",
        "src/types/note.ts",
        "src/notes/note.types.ts",
      ].map((path) => [path, trackOf(express, path)]),
    );
    expect(tracks).toEqual({
      "src/notes/notes.routes.ts": "backend",
      "src/app.ts": "backend",
      "package.json": "setup",
      "tsconfig.json": "setup",
      "prisma/schema.prisma": "database",
      "db/migrations/001_init.sql": "database",
      Dockerfile: "deployment",
      "docker-compose.yml": "deployment",
      ".github/workflows/ci.yml": "deployment",
      "src/types/note.ts": "shared",
      "src/notes/note.types.ts": "shared",
    });
  });

  it("put a NestJS project's files in their tracks (#96)", () => {
    const nest = profileFor(["nestjs 12.2.0"]);
    expect(nest).toMatchObject({ id: "nestjs", label: "NestJS", kind: "backend", run: { scripts: ["start", "start:prod"], portEnv: "PORT", readyPaths: ["/health", "/"] } });
    const tracks = Object.fromEntries(
      ["src/main.ts", "src/tasks/tasks.module.ts", "src/tasks/task.entity.ts", "src/auth/api-key.guard.ts", "nest-cli.json", "vitest.config.ts", "prisma/schema.prisma", "Dockerfile"].map((path) => [path, trackOf(nest, path)]),
    );
    expect(tracks).toEqual({
      "src/main.ts": "backend",
      "src/tasks/tasks.module.ts": "backend",
      // Plain types without an ORM: the TypeORM profile (#99) decides about entities.
      "src/tasks/task.entity.ts": "backend",
      "src/auth/api-key.guard.ts": "backend",
      "nest-cli.json": "setup",
      "vitest.config.ts": "setup",
      "prisma/schema.prisma": "database",
      Dockerfile: "deployment",
    });
  });
});

describe("what reads the profile", () => {
  const graph = graphSchema.parse(graphFixture);
  const summaries = summariesFixture as Summaries;
  const path = learningPath.parse(planFixture);

  it("the planner: build order and check hints (Express unchanged, generic phrased for any project)", () => {
    const input = { track: "backend" as const, size: "standard" as const, units: buildUnits(graph), summaries, hasTests: true };
    const forExpress = planPrompt({ ...input, profile: express });
    expect(forExpress).toContain("# Express projects\nNatural build order:\n1. configuration and shared types");
    expect(forExpress).toContain("- routes and the app: HTTP requests against the running app");
    expect(planPrompt({ ...input, profile: generic })).toContain("# Projects in general");
  });

  it("the check writer: how the framework's steps are checked", () => {
    const ctx = { step: path.steps[0]!, diff: "", importPaths: new Map(), dependencies: [], exports: new Map(), context: new Map() };
    expect(checksPrompt({ ...ctx, profile: express })).toContain("How steps of Express projects are usually checked:\n- routes and the app");
    expect(checksPrompt(ctx)).not.toContain("usually checked");
  });

  it("lessons, hints and the chat: the framework's architecture notes", () => {
    const context = stepContext({ projectName: "express-notes", path, stepId: path.steps[0]!.id, summaries, diff: "", profile: express });
    expect(context).toContain("# Express notes (use them where this step meets them)");
    expect(context).toContain("Routers group the routes of one feature");
    expect(stepContext({ projectName: "x", path, stepId: path.steps[0]!.id, summaries, diff: "", profile: generic })).not.toContain("notes (use them");
  });
});
