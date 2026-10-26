import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeHttpProblem, httpChecksPrompt, httpRun, runHttpCheck, runStepChecks, type Check, type HttpOutcome, type WorkspaceFiles } from "../src/index.ts";
import { findKnycSys, NodeHost, sysArgs } from "../src/node.ts";

const passed: HttpOutcome = { status: "pass", port: 4000, requests: [{ method: "GET", path: "/notes", status: 200, body: "[]" }], output: "listening", durationMs: 120 };
const failed: HttpOutcome = {
  status: "fail",
  port: 4000,
  requests: [{ method: "POST", path: "/notes", status: 404, body: "Cannot POST /notes", problem: "expected status 201, got 404" }],
  output: "listening",
  durationMs: 90,
};

describe("HTTP checks (#88)", () => {
  it("ask for requests the step makes answer, against a fresh server", () => {
    const prompt = httpChecksPrompt({ step: { id: "s09", title: "Routes", goal: "POST /notes returns 201" } as never, diff: "+router.post('/notes')", importPaths: new Map(), dependencies: [], exports: new Map(), context: new Map() });
    expect(prompt).toContain("Goal: POST /notes returns 201");
    expect(prompt).toContain("+router.post('/notes')");
    expect(prompt).toContain("each check starts with a fresh server");
  });

  it("are proven only when they fail before the step and pass at it", () => {
    expect(describeHttpProblem("creates a note", passed, failed)).toBeUndefined();
    expect(describeHttpProblem("creates a note", failed, null)).toBe('"creates a note" fails after the step: POST /notes: expected status 201, got 404');
    expect(describeHttpProblem("lists notes", passed, passed)).toContain("already passes before the step");
    const crashed: HttpOutcome = { status: "error", requests: [], output: "Error: Cannot find module", error: "the server stopped before answering (exit code 1)", durationMs: 50 };
    expect(describeHttpProblem("x", crashed, null)).toContain("the server stopped before answering");
  });

  it("show the learner each request's answer and what the server printed", () => {
    const run = httpRun("chk-s09-1", failed, "2026-10-26T12:00:00.000Z");
    expect(run).toMatchObject({ checkId: "chk-s09-1", status: "fail", durationMs: 90 });
    expect(run.output).toBe("POST /notes → 404: expected status 201, got 404\n\nServer output:\nlistening");
    expect(run.failures).toEqual([{ message: "POST /notes: expected status 201, got 404", actual: "Cannot POST /notes" }]);
    const crashed = httpRun("chk-s09-1", { status: "error", requests: [], output: "Error: Cannot find module './dist/server.js'", error: "the server stopped before answering (exit code 1)", durationMs: 50 }, "2026-10-26T12:00:00.000Z");
    expect(crashed.failures[0]!.message).toBe("the server stopped before answering (exit code 1)\nError: Cannot find module './dist/server.js'");
  });

  it("run in the learner's workspace from its package, after the build", async () => {
    const files: WorkspaceFiles = { read: async () => "", write: async () => {}, remove: async () => {}, exists: async () => true };
    const calls: string[] = [];
    const check: Check = {
      schemaVersion: 1,
      id: "chk-s09-1",
      stepId: "s09",
      label: "POST /notes returns 201",
      origin: "generated",
      timeoutMs: 30_000,
      spec: { kind: "http", server: { start: "npm run start", root: "apps/api", port: 3000, readyPath: "/" }, requests: [{ method: "POST", path: "/notes", body: { title: "a" }, expect: { status: 201 } }] },
    };
    const results = await runStepChecks({
      checks: [check],
      pathId: "p",
      files,
      run: async (r) => (calls.push(`${r.root} ${r.command}`), { status: "pass" }),
      commands: [{ root: "apps/api", build: "npm run build" }],
      runHttp: async (request) => (calls.push(`http ${request.root} ${request.server.start} ${request.requests.length}`), passed),
    });
    expect(calls).toEqual(["apps/api npm run build", "http apps/api npm run start 1"]);
    expect(results[0]).toMatchObject({ checkId: "chk-s09-1", status: "pass" });
  });

  it("go to knyc-sys as one JSON spec", () => {
    const args = sysArgs({ op: "http", cwd: "/w", timeoutMs: 5000, server: { start: "npm start", port: 3000, readyPath: "/" }, requests: [] });
    expect(args.slice(0, 5)).toEqual(["http", "--cwd", "/w", "--timeout-ms", "5000"]);
    expect(JSON.parse(args[6]!)).toEqual({ server: { start: "npm start", port: 3000, readyPath: "/" }, requests: [] });
  });
});

const knycSys = findKnycSys();

describe.skipIf(!knycSys)("HTTP checks with the real knyc-sys binary", () => {
  it("start the server, send the requests, compare, and stop it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knyc-http-"));
    writeFileSync(
      join(dir, "server.cjs"),
      `require("http").createServer((q, s) => { if (q.url === "/notes") { s.setHeader("content-type", "application/json"); s.end(JSON.stringify([{ id: 1, title: "a" }])); return; } s.statusCode = 404; s.end(); }).listen(process.env.PORT);`,
    );
    const outcome = await runHttpCheck(new NodeHost({ binary: knycSys }), dir, { start: "node server.cjs", port: 3999, readyPath: "/" }, [
      { method: "GET", path: "/notes", expect: { status: 200, jsonSubset: [{ title: "a" }] } },
      { method: "GET", path: "/missing", expect: { status: 200 } },
    ]);
    expect(outcome.status).toBe("fail");
    expect(outcome.requests.map((r) => r.problem ?? "ok")).toEqual(["ok", "expected status 200, got 404"]);
  }, 30_000);
});
