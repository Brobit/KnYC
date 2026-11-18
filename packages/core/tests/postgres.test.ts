import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { databaseOf, prismaProvider, profiles, runCommand, runStepChecks, type Check, type CheckCommand, type Graph, type WorkspaceFiles } from "../src/index.ts";
import { findKnycSys, NodeHost, sysArgs } from "../src/node.ts";

const graphOf = (paths: string[]) => ({ files: paths.map((path) => ({ path })) }) as unknown as Graph;

describe("Postgres for the database track (#116)", () => {
  it("is picked from the Prisma schema's provider", async () => {
    const schema = (provider: string) => `generator client {\n  provider = "prisma-client"\n}\n\ndatasource db {\n  provider = "${provider}"\n}\n\nmodel A {\n  id Int @id\n}\n`;
    expect(prismaProvider(schema("postgresql"))).toBe("postgresql");
    expect(prismaProvider(schema("sqlite"))).toBe("sqlite");
    expect(prismaProvider("model A { id Int @id }")).toBeUndefined();

    const files: Record<string, string> = { "prisma/schema.prisma": schema("postgresql"), "apps/api/prisma/schema.prisma": schema("sqlite") };
    const read = async (file: string) => files[file] ?? Promise.reject(new Error("missing"));
    expect(await databaseOf(graphOf(["src/app.ts", "prisma/schema.prisma"]), read)).toBe("postgres");
    expect(await databaseOf(graphOf(["apps/api/prisma/schema.prisma"]), read)).toBeUndefined();
    expect(await databaseOf(graphOf(["src/app.ts"]), read)).toBeUndefined();
  });

  it("gives the Prisma checks a recipe that makes a database on the check's server", () => {
    expect(profiles.prisma!.check.postgres?.recipe).toContain("process.env.KNYC_POSTGRES_URL");
    expect(profiles.prisma!.check.postgres?.recipe).toContain('prisma("migrate", "deploy")');
    expect(profiles.prisma!.check.postgres?.hints.join("\n")).not.toMatch(/SQLite/);
  });

  it("asks knyc-sys for a server next to the command", () => {
    const args = sysArgs({ op: "run", cwd: "/w", command: "node --test a.mjs", timeoutMs: 60_000, env: {}, database: "postgres" });
    expect(args).toEqual(["run", "--cwd", "/w", "--timeout-ms", "60000", "--database", "postgres", "--", "node", "--test", "a.mjs"]);
  });

  it("runs the learner's test checks with their server, generated or the project's own", async () => {
    const files: WorkspaceFiles = { read: async () => "", write: async () => {}, remove: async () => {}, exists: async () => true };
    const asked: CheckCommand[] = [];
    const test = (id: string, origin: Check["origin"], filter: string[]): Check => ({
      schemaVersion: 1,
      id,
      stepId: "s02",
      label: id,
      origin,
      timeoutMs: 60_000,
      spec: { kind: "test", root: ".", runner: origin === "repo" ? "vitest" : "other", command: origin === "repo" ? "npx vitest run" : "node --test .knyc-checks/s02-1.test.mjs", filter, files: [], database: "postgres" },
    });
    await runStepChecks({
      checks: [test("chk-s02-1", "generated", []), test("chk-s02-2", "repo", ["catalog › adds a book"])],
      pathId: "p",
      files,
      testFiles: [],
      run: async (request) => (asked.push(request), { status: "pass" }),
    });
    expect(asked.map((r) => [r.command, r.database])).toEqual([
      ["npx vitest run", "postgres"],
      ["node --test .knyc-checks/s02-1.test.mjs", "postgres"],
    ]);
  });
});

const knycSys = findKnycSys();
const dockerRunning = (() => {
  try {
    execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!knycSys || !dockerRunning)("Postgres with the real knyc-sys and Docker", () => {
  it("starts a server for the command, gives it the URLs and removes it after", async () => {
    const dir = mkdtempSync(`${tmpdir()}/knyc-pg-`);
    const script = "const n=require('net');const u=new URL(process.env.DATABASE_URL);n.connect(+u.port,u.hostname,function(){console.log(u.pathname,process.env.KNYC_POSTGRES_URL.startsWith('postgresql://'));this.end()})";
    const outcome = await runCommand(new NodeHost({ binary: knycSys }), dir, `node -e "${script}"`, { timeoutMs: 60_000, database: "postgres" });
    expect(outcome.status, JSON.stringify(outcome)).toBe("pass");
    expect(outcome.run?.stdout.trim()).toBe("/knyc true");
    expect(execFileSync("docker", ["ps", "-aq", "--filter", "label=knyc=check", "--filter", "name=knyc-pg-"]).toString().trim()).toBe("");
  }, 180_000);
});
