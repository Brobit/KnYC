import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditCheck } from "../src/index.ts";

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
