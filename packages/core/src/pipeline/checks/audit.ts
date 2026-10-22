// A quick, deterministic look at what a generated check really asserts (M1 evaluation, #15).
// "Proven red → green" only says the check fails before and passes after; a check that only
// imports a module passes that test too, without proving the learner wrote anything meaningful.

export type CheckKind = "behavior" | "trivial";

export interface CheckAudit {
  kind: CheckKind;
  /** Assertions found. */
  assertions: number;
  /** Assertions that only test existence or type ("typeof x === 'function'", "assert.ok(mod)"). */
  existenceOnly: number;
}

const ASSERTION = /\bassert(?:\.(\w+))?\s*\(([^;]*)/g;
const EXISTENCE = /typeof\s|instanceof\s+Function|\bin\s+\w+\)|Object\.keys\(|!==?\s*undefined|!=\s*null/;

/** Counts assertions in a check file and how many only test that something exists. */
export function auditCheck(code: string): CheckAudit {
  let assertions = 0;
  let existenceOnly = 0;
  for (const match of code.matchAll(ASSERTION)) {
    const method = match[1] ?? "ok";
    if (method === "rejects" || method === "throws" || method === "doesNotThrow" || method === "fail") {
      assertions += 1; // behavior: calling the code and expecting an error
      continue;
    }
    assertions += 1;
    const args = match[2] ?? "";
    const isOk = method === "ok" || method === "strictEqual" || method === "equal";
    // assert.ok(x), assert.ok(typeof f === "function"), assert.equal(typeof f, "function")
    if ((isOk && EXISTENCE.test(args)) || (method === "ok" && /^\s*[\w.$]+\s*[,)]/.test(args))) existenceOnly += 1;
  }
  return { kind: assertions > existenceOnly ? "behavior" : "trivial", assertions, existenceOnly };
}
