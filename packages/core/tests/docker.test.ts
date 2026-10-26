import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dockerRun, runDockerCheck, runStepChecks, type Check, type DockerOutcome, type WorkspaceFiles } from "../src/index.ts";
import { findKnycSys, NodeHost, sysArgs } from "../src/node.ts";

const at = "2026-10-26T12:00:00.000Z";

describe("Docker checks (#90)", () => {
  it("say plainly when Docker is missing, and show the build output when it fails", () => {
    const unavailable = dockerRun("chk-s12-1", { status: "unavailable", stage: "build", output: "", error: "Docker isn't installed or isn't running", durationMs: 5 }, at);
    expect(unavailable).toMatchObject({ status: "error", failures: [{ message: "This check needs Docker, installed and running." }] });

    const broken = dockerRun("chk-s12-1", { status: "fail", stage: "build", output: "Step 2/3 : RUN npm ci\nnpm ERR! missing package-lock.json", error: "the image doesn't build", durationMs: 4000 }, at);
    expect(broken.status).toBe("fail");
    expect(broken.failures[0]!.message).toBe("the image doesn't build\nStep 2/3 : RUN npm ci\nnpm ERR! missing package-lock.json");
    expect(dockerRun("chk-s12-1", { status: "pass", stage: "health", output: "ok", durationMs: 9000 }, at).failures).toEqual([]);
  });

  it("run in the learner's workspace with their Dockerfile", async () => {
    const files: WorkspaceFiles = { read: async () => "", write: async () => {}, remove: async () => {}, exists: async () => true };
    const asked: unknown[] = [];
    const check: Check = { schemaVersion: 1, id: "chk-s12-1", stepId: "s12", label: "The image builds and answers", origin: "generated", timeoutMs: 120_000, spec: { kind: "docker", context: ".", dockerfile: "Dockerfile", run: { port: 3000, healthPath: "/health" } } };
    const results = await runStepChecks({
      checks: [check],
      pathId: "p",
      files,
      run: async () => ({ status: "pass" }),
      runDocker: async (request) => (asked.push(request), { status: "pass", stage: "health", output: "", durationMs: 1 }) as DockerOutcome,
    });
    expect(asked).toEqual([{ timeoutMs: 120_000, spec: { context: ".", dockerfile: "Dockerfile", run: { port: 3000, healthPath: "/health" } } }]);
    expect(results[0]!.status).toBe("pass");
  });

  it("go to knyc-sys as one JSON spec", () => {
    const args = sysArgs({ op: "docker", cwd: "/w", timeoutMs: 60_000, spec: { context: ".", dockerfile: "Dockerfile" } });
    expect(args).toEqual(["docker", "--cwd", "/w", "--timeout-ms", "60000", "--spec", '{"context":".","dockerfile":"Dockerfile"}']);
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

describe.skipIf(!knycSys || !dockerRunning)("Docker checks with the real knyc-sys and Docker", () => {
  it("build and run a step's Dockerfile, then remove what they made (Done when)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knyc-docker-"));
    mkdirSync(join(dir, "www"));
    writeFileSync(join(dir, "www", "health"), "ok");
    writeFileSync(join(dir, "Dockerfile"), 'FROM busybox:1.36\nCOPY www /www\nEXPOSE 8080\nCMD ["httpd", "-f", "-p", "8080", "-h", "/www"]\n');
    const outcome = await runDockerCheck(new NodeHost({ binary: knycSys }), dir, { context: ".", dockerfile: "Dockerfile", run: { port: 8080, healthPath: "/health" } }, 120_000);
    expect(outcome).toMatchObject({ status: "pass", stage: "health" });
    const left = execFileSync("docker", ["ps", "-aq", "--filter", "label=knyc=check"]).toString().trim();
    expect(left).toBe("");
  }, 180_000);
});
