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

// A fixed port that is really used: listened on, fetched, or given to a program the check starts.
// A port only read back as data (`PORT: "4321"` into loadConfig, a base URL string) is fine.
const LISTEN_FIXED = /\.listen\(\s*\d{2,5}\b|fetch\(\s*["'`]https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}\b/;
const STARTS_PROGRAM = /\b(?:spawn|spawnSync|exec|execFile|execSync|fork)\s*\(/;
const PORT_LITERAL = /\bport\s*[:=]\s*\d{2,5}\b|\bPORT\s*:\s*(?:String\(\s*)?["'`]?\d{2,5}\b/i;
const CONSTRUCTED = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+[A-Z]/g;

/**
 * What makes a generated check fail for a correct learner (the alpha run, #66): a fixed port
 * (busy on the learner's machine) and fields set on an object the code built (`store.now = …`
 * passes only if the learner names an internal field the same way). One message per problem,
 * phrased for the model; empty when the check is fine.
 */
export function fragileCheck(code: string): string[] {
  const problems: string[] = [];
  if (LISTEN_FIXED.test(code) || (STARTS_PROGRAM.test(code) && PORT_LITERAL.test(code))) {
    problems.push("it uses a fixed port, which may be busy on the learner's machine: listen on port 0, or get a free port first and pass it through PORT");
  }
  const fields = new Set<string>();
  for (const [, name] of code.matchAll(CONSTRUCTED)) {
    for (const [, field] of code.matchAll(new RegExp(`\\b${name!.replace(/\$/g, "\\$")}\\.([A-Za-z_$][\\w$]*)\\s*=(?!=)`, "g"))) fields.add(`${name}.${field}`);
  }
  if (fields.size > 0) {
    problems.push(`it sets ${[...fields].join(", ")} from outside, an internal field the learner may name differently: only use the public API (constructor arguments, methods, exports)`);
  }
  return problems;
}
