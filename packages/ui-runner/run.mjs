// KnYC's UI check runner (#89, design/06 H4). It ships next to the app with its own playwright-core
// and runs on the learner's Node.js, so nothing is added to the learner's project. Chromium (the
// headless shell) lives in the folder PLAYWRIGHT_BROWSERS_PATH names: KnYC's data folder.
//
//   node run.mjs status                 → {"installed": bool, "revision": "1243"}
//   node run.mjs size                   → {"bytes": n, "urls": [...]}
//   node run.mjs install                → {"installed": true} once downloaded
//   node run.mjs test <spec.json>       → writes the outcome to spec.out
//
// A UI test is an ES module in the workspace whose default export gets a fresh page:
//   export default async function ({ page }) { await page.goto("/"); … }
// It fails by throwing (node:assert, or a locator that never appears).

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const core = dirname(require.resolve("playwright-core/package.json"));
const cli = join(core, "cli.js");

const MAX_SNAPSHOT = 4000;
const MAX_ERRORS = 10;

/** The headless shell's revision for this playwright-core. */
export function revision() {
  const { browsers } = JSON.parse(readFileSync(join(core, "browsers.json"), "utf8"));
  return browsers.find((b) => b.name === "chromium-headless-shell").revision;
}

function browsersPath() {
  const path = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!path || path === "0") throw new Error("PLAYWRIGHT_BROWSERS_PATH must name KnYC's browsers folder");
  return path;
}

export function installed(path = browsersPath()) {
  return existsSync(join(path, `chromium_headless_shell-${revision()}`, "INSTALLATION_COMPLETE"));
}

function playwright(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { env: process.env });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ code, output }));
  });
}

/** The first download URL of each item `install --dry-run` lists. */
export function downloadUrls(dryRun) {
  const urls = [];
  for (const block of dryRun.split(/\r?\n\s*\r?\n/)) {
    const url = block.match(/Download url:\s+(\S+)/);
    if (url) urls.push(url[1]);
  }
  return urls;
}

async function size() {
  const { output } = await playwright(["install", "--dry-run", "--only-shell", "chromium"]);
  const urls = downloadUrls(output);
  let bytes = 0;
  for (const url of urls) {
    const answer = await fetch(url, { method: "HEAD", redirect: "follow" });
    bytes += Number(answer.headers.get("content-length") ?? 0);
  }
  return { bytes, urls };
}

async function install() {
  const { code, output } = await playwright(["install", "--only-shell", "chromium"]);
  if (code !== 0 || !installed()) return { installed: false, error: output.trim().split("\n").slice(-10).join("\n") };
  return { installed: true };
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}\n…` : text);

/** The error, with the stack lines that point into the test file. */
function describe(error, file) {
  // eslint-disable-next-line no-control-regex
  const message = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, "");
  const at = (error instanceof Error && error.stack ? error.stack.split("\n") : []).filter((l) => l.includes(pathToFileURL(file).href) || l.includes(file)).slice(0, 3);
  return [message.trim(), ...at.map((l) => l.trim())].join("\n");
}

async function runTest(browser, baseUrl, file, timeoutMs) {
  const started = Date.now();
  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  page.setDefaultNavigationTimeout(15_000);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.length < MAX_ERRORS && pageErrors.push(e.message));
  page.on("console", (m) => m.type() === "error" && pageErrors.length < MAX_ERRORS && pageErrors.push(m.text()));
  try {
    const test = (await import(`${pathToFileURL(file).href}?run=${started}`)).default;
    if (typeof test !== "function") throw new Error("the UI test has no default export function");
    let timer;
    const limit = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`the test didn't finish within ${timeoutMs / 1000} s`)), timeoutMs)));
    try {
      await Promise.race([test({ page, baseUrl }), limit]);
    } finally {
      clearTimeout(timer);
    }
    return { file, status: "pass", durationMs: Date.now() - started };
  } catch (error) {
    const snapshot = await page.locator("body").ariaSnapshot({ timeout: 2_000 }).catch(() => "");
    const screenshot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 5_000 }).catch(() => null);
    return {
      file,
      status: "fail",
      durationMs: Date.now() - started,
      error: describe(error, file),
      url: page.url(),
      pageErrors,
      snapshot: cut(snapshot, MAX_SNAPSHOT),
      ...(screenshot ? { screenshot: screenshot.toString("base64") } : {}),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function test(specFile) {
  const spec = JSON.parse(readFileSync(specFile, "utf8"));
  const write = (outcome) => writeFileSync(spec.out, JSON.stringify(outcome));
  if (!installed()) return write({ status: "unavailable", tests: [], error: "Chromium isn't downloaded yet" });
  const { chromium } = await import("playwright-core");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    return write({ status: "error", tests: [], error: `Chromium didn't start: ${error instanceof Error ? error.message : error}` });
  }
  try {
    const tests = [];
    for (const file of spec.tests) tests.push(await runTest(browser, spec.baseUrl, file, spec.timeoutMs ?? 30_000));
    write({ status: tests.every((t) => t.status === "pass") ? "pass" : "fail", tests });
  } finally {
    await browser.close().catch(() => {});
  }
}

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, arg] = process.argv.slice(2);
  try {
    if (command === "status") print({ installed: installed(), revision: revision() });
    else if (command === "size") print(await size());
    else if (command === "install") print(await install());
    else if (command === "test" && arg) await test(arg);
    else throw new Error(`usage: node ${join(here, "run.mjs")} status | size | install | test <spec.json>`);
  } catch (error) {
    print({ error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}
