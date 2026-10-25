import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditCheck, fragileCheck } from "../src/index.ts";

describe("auditCheck", () => {
  it("sees behavior when the check asserts on results or errors", () => {
    const code = `import assert from 'node:assert/strict';
const config = loadConfig({});
assert.equal(config.port, 3000);
assert.throws(() => cart.setQuantity('u1', 'p', 1), /not in the cart/);`;
    expect(auditCheck(code)).toEqual({ kind: "behavior", assertions: 2, existenceOnly: 0 });
  });

  it("flags checks that only test that something exists", () => {
    const importOnly = `import * as mod from '../dist/notes/note.js';\nassert.ok(mod);`;
    const typeofOnly = `assert.equal(typeof notesRouter, 'function');\nassert.ok(typeof store.list === 'function');`;
    expect(auditCheck(importOnly).kind).toBe("trivial");
    expect(auditCheck(typeofOnly)).toEqual({ kind: "trivial", assertions: 2, existenceOnly: 2 });
  });

  it("matches the three trivial checks found in the real M1 runs", () => {
    const labels: string[] = [];
    for (const name of ["express-notes", "express-no-tests", "express-shop"]) {
      const run = JSON.parse(readFileSync(new URL(`./fixtures/checks/${name}.standard.checks.json`, import.meta.url), "utf8"));
      for (const c of run.checks) {
        if (c.origin === "generated" && c.spec.kind === "test" && auditCheck(run.files[c.spec.files[0]]).kind === "trivial") labels.push(c.label);
      }
    }
    expect(labels).toEqual([
      "notes.validation module compiles and loads",
      "notes.routes module compiles and loads without error",
      "dist/links/link.js module exists and loads",
    ]);
  });
});

describe("fragileCheck", () => {
  // The two fragile checks of the alpha run (#66), cut to what matters.
  const setsAField = `const store = new NotesStore();
store.now = () => time;
const created = store.create({ title: 'A', body: 'B', tags: [] });
assert.equal(created.updatedAt === created.createdAt, true);`;
  const fixedPort = `const port = 34567;
const child = spawn(process.execPath, ["dist/server.js"], { env: { ...process.env, PORT: String(port) } });
const res = await fetch(\`http://localhost:\${port}/health\`);`;

  it("flags fields set from outside on an object the code built", () => {
    expect(fragileCheck(setsAField)).toEqual([expect.stringContaining("it sets store.now from outside")]);
  });

  it("flags fixed ports that are listened on, fetched or given to a program", () => {
    expect(fragileCheck(fixedPort)).toEqual([expect.stringContaining("fixed port")]);
    expect(fragileCheck("const server = app.listen(3000);")).toHaveLength(1);
    expect(fragileCheck("await fetch('http://localhost:8080/notes');")).toHaveLength(1);
  });

  it("accepts port 0, ports read as data and comparisons", () => {
    const fine = `const server = app.listen(0);
const { port } = server.address();
const config = loadConfig({ PORT: '4321' });
app.use('/api/links', linksApiRouter(service, 'http://localhost:9999'));
const store = new NotesStore(() => fixed);
assert.ok(store.list().length === 0);
if (res.status == 200) store.size;`;
    expect(fragileCheck(fine)).toEqual([]);
  });

  it("finds nothing fragile in the checks of the real M1 runs", () => {
    for (const name of ["express-notes", "express-no-tests", "express-shop"]) {
      const run = JSON.parse(readFileSync(new URL(`./fixtures/checks/${name}.standard.checks.json`, import.meta.url), "utf8"));
      for (const c of run.checks) {
        if (c.origin === "generated" && c.spec.kind === "test") expect(fragileCheck(run.files[c.spec.files[0]]), c.label).toEqual([]);
      }
    }
  });
});
