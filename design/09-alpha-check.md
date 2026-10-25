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

## Pipeline findings (not fixed: they need design choices)

All steps went green because the learner was given the original's shape when the goal was not
enough. A real learner, working only from the step's goal, would have been stuck on several:

| Step | What the checks need | What the goal says |
|---|---|---|
| s05 create | `new NotesStore(clock)`: the repo test injects a fixed clock | "an ISO createdAt/updatedAt timestamp" |
| s06 update | a generated check sets `store.now = …` from outside (a private field) | — |
| s08 validation | `parseNoteInput(body, maxTitleLength, partial)`; tags lowercased and deduplicated, title trimmed | `parseNoteInput(body)` "returns a clean NoteInput" |
| s10 app | `GET /health` → `{ status: "ok" }` | only the /notes endpoints and a JSON 404 |
| s11 server | a startup log containing `http://localhost:<port>`; fixed port 34567 | "starts the Express app listening" |
| s04 read | only tests an empty store (`list()` returning `[]` passes) | list / get |

So, for after the alpha (proposed M4 issues, to discuss):

1. **Contracts in the goal.** The planner (or lesson generation) should state what the checks rely
   on: exact signatures, constructor parameters, routes, output the checks read. They can be read
   from the checks themselves once they are proven (the repo test's calls, the generated check's
   imports and assertions), then added to the step as a "Contract" list shown in the lesson.
2. **Generated checks use the public API only.** Add a rule to the check prompt (no assignment to
   instance fields, no private members), and an `auditCheck` rule to flag it.
3. **No fixed ports in generated checks.** Ask for port 0 or a free port given through the
   environment; flag literal ports in `auditCheck`.
4. **Weak first steps of a data structure** (s04): when a step's behavior can't be observed yet,
   merge it with the next one (design/08 improvement 1 already counts weak steps).

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
