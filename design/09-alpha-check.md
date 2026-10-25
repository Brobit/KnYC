# 09 — Alpha check (M3)

Status: **passed** (2026-10-25). Issue #66, milestone "M3 — Learning loop" ([design 06](06-roadmap.md)).

## The question

M3's "Done when": **a learner can rebuild a golden repo from start to finish in the app.** This is
the first run of the whole learning loop against the real Claude Code CLI, in the real desktop app
(`pnpm --filter @knyc/desktop tauri dev`), on macOS.

## The run

- Project: `fixtures/golden/express-notes`, imported through the Import screen; workspace
  `~/KnYC/express-notes` (new folder).
- Path: Backend track, size standard, no setup step → **11 steps**, 29 checks
  (17 generated, 12 from the repo's own Vitest suite).
- Analysis and path preparation ran in the app as a background job (intake → scan → graph →
  summaries 8/8 → plan → timeline → checks 11/11), all through the user's Claude Code login.
- The learner's code was written by Claude from each step's goal (not copied from the original),
  and every step was checked with the app's **Run checks**: **11 / 11 steps green, each on the
  first attempt.** One hint used (step 5). `.knyc/snapshots.git` has one snapshot per passed step.
- Before each run in the app, the same checks were run by hand on a copy of the workspace
  (install, build, `node --test` on the generated checks, `vitest` for the repo's): same results.

## App bugs found and fixed (branch `m3/alpha-check`)

1. **Start step 1 left an empty workspace.** The Rust workspace scope (`workspace/scope.rs`
   `resolve`) only looked one folder up for an existing ancestor, so in a new workspace any path
   two levels deep (`.knyc/project.json` while `.knyc/` doesn't exist yet) failed with an io error,
   and `exists` threw instead of answering false. It now walks up to the closest existing folder
   (what lies below can't be a symlink, so the outside-the-workspace guard is unchanged). The app's
   tests use a fake file system, which is why no test saw it; two Rust tests added.
2. **An app opened from the Finder doesn't find `npm` / `node` / `claude`.** GUI apps on macOS start
   with the system PATH only (`/usr/bin:/bin:/usr/sbin:/sbin`), so checks, runs and the toolchain
   status would miss nvm / Homebrew installs (the built-in terminal worked: it is a login shell).
   New `shell_path.rs`: at start-up, outside Windows, the app asks `$SHELL -i -l` for its PATH
   (between markers, 5 s timeout, current PATH kept on any failure). Same need on Linux desktops.
   Not yet tried with a packaged `.app` opened from the Finder: do it with the release build.

## Pipeline findings

All steps went green because the learner was given the original's shape when the goal was not
enough. Working from the step's goal alone, a learner would have been stuck on several. The
lessons (which see the original's change) already covered some of it, but not what only the
checks pin down:

| Step | What the checks need | Goal | Lesson (as generated in the run) |
|---|---|---|---|
| s05 create | `new NotesStore(clock)`: the repo test injects a fixed clock | "an ISO timestamp" | `this.now()`, never says the constructor takes it |
| s06 update | a generated check sets `store.now = …` from outside (an internal field) | — | — |
| s08 validation | `parseNoteInput(body, maxTitleLength, partial)`; tags lowercased and deduplicated | `parseNoteInput(body)` | complete |
| s10 app | `GET /health` → `{ status: "ok" }` | not mentioned | "a small JSON status payload" |
| s11 server | a startup log containing `http://localhost:<port>`; fixed port 34567 | "starts listening" | "a short startup message" |
| s04 read | only tests an empty store (`list()` returning `[]` passes) | list / get | — |

### Fixed on this branch

1. **The lesson sees the step's checks** (`learn/lesson.ts`): `checkSources` gives it each
   generated check's file and the project's test file behind each repo check (matched on the
   `it(…)` title), cut at 12 000 characters, under "The checks the learner's code must pass (for
   you only)". The lesson must end with a **"What the checks expect"** list: signatures and
   parameter order, constructor parameters, status codes, exact responses, output the checks read,
   environment variables — what, never how. Hints, explanations and chat get the same context
   (`stepContext`). Tried for real (sonnet) on s05 of this run: the list now says the timestamps
   come "from the store's injected clock function (not `new Date()` directly)".
2. **Fragile generated checks are refused** (`pipeline/checks/audit.ts` `fragileCheck`, applied
   in `prepareChecks` before a candidate runs, the reason sent back to the model): fields set from
   outside on an object the check built (`store.now = …`), and fixed ports that are listened on,
   fetched or given to a program the check starts. It flags both alpha checks and none of the 78
   generated checks of the M1 runs (a port read back as data, `PORT: "4321"` into `loadConfig`,
   is fine). The check prompt now says the same, plus: start the project's entry point on a free
   port, wait with fetch, don't depend on printed text the goal doesn't state.
3. **Planner rules** (`pipeline/plan.ts`): reads (list, get, find) go with or after the writes
   that add their data (s04), and goals name what a check calls that the learner can't guess (a
   clock or store parameter, /health, the exact response).

Not yet measured: these change the AI prompts, so the analysis cache is cold for them. A
`knyc eval` on the three golden repos would show the effect on the plan and the checks (and
whether goals stay under their 300 characters). No automated test runs the generated-check
loop itself (`fragileCheck` is unit-tested; its wiring in `prepareChecks` is only covered by a
real run). Steps already prepared keep their checks; lessons are generated anew only for steps
not opened yet.

## Smaller notes

- Time on a step is counted only while the KnYC window has focus, in whole minutes, and the
  minute timer restarts after each progress save: short steps read 0 s. Fine for the alpha.
- In a plain browser the app runs its fakes (onboarding again, sample project), so the browser
  preview can't check a real workspace: the alpha check needs the desktop window.
- The dev launch config for this checkout must use port 1420 (Vite's), not 3000.

## Left for v0.1.0-alpha

- Build and try the installers on the three OS (`release` workflow: tag → draft release), including
  the Finder-opened `.app` for fix 2. Remaining #39 checks on macOS / Linux: panel dragging,
  keychain (`cargo test -p knyc --lib -- --ignored os_keychain`).
