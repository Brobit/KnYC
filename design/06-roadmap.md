# 06 — Roadmap

Status: **agreed** (2026-10-21) — decisions at the end.

## Strategy

1. **Riskiest first.** The UI is known territory. The unknown is whether the AI can reliably produce
   a good path with a valid reference timeline and red → green checks (design 02). We prove that
   **before** building the full app, with a headless CLI.
2. **Thin vertical slices.** One stack end to end before adding more stacks.
3. **Always shippable.** From M0, every milestone ends with downloadable builds for macOS, Windows
   and Linux (pre-releases until v1.0).
4. **Golden repos.** A small corpus of real sample projects per stack, used as a regression suite:
   every change to the pipeline is re-run on them, with metrics (steps validated, weak checks,
   retries, cost).

Sizes are relative (S / M / L / XL), not dates.

---

## M0 — Foundations (S)

- pnpm + Cargo monorepo with the layout of design 01; `LICENSE` (GPL-3.0), README, CONTRIBUTING.
- Tauri 2 app that opens a window with "Hello KnYC" (React + Tailwind + shadcn/ui, i18next wired).
- CI (GitHub Actions): lint, typecheck, tests, and a **build matrix on macOS / Windows / Linux**
  with `tauri-action`, creating a draft release with the stable asset names (design 05).
- Landing page skeleton (Astro) deployed to GitHub Pages with a working "Download" button.

**Done when**: someone on each OS can download `v0.0.1` from the landing page and open the app.

## M1 — Core spike: does the idea work? (L) — go / no-go

**Result: GO** (2026-10-22): 39/46 steps (85 %) proven red → green with behavior checks on the
golden repos. Details and the improvements carried forward: [design 08](08-m1-evaluation.md).

Headless `knyc` CLI, no UI. **One stack: TypeScript + Node backend (Express) with Vitest/Jest.**

- Rust: intake, static scan, tree-sitter graph for TS/JS (`knyc-analyzer`); process runner
  (`knyc-runner`).
- Rust ↔ TS without Tauri: a small Rust binary **`knyc-sys`** (`scan`, `graph`, `run`) prints
  JSON; the TS CLI spawns it. The Tauri app will call the same crates directly.
- TS (`packages/core`): Zod schemas (design 03), AI layer (one provider for development: the
  user's local **Claude Code CLI** in headless mode; API-key providers come later),
  summaries, curriculum plan + deterministic validation, reference timeline in `reference.git`,
  existing-test mapping, generated checks with red → green validation.
- `knyc analyze <folder> --track backend --size standard` → writes `.knyc/` and a report.
- 3 golden repos (small, medium, one without tests).
- Tracked as GitHub milestone "M1 — Core spike", issues #4–#15.

**Done when**: on the golden repos, ≥ 80 % of steps have validated (strong) checks and every `Rk`
builds. **If not**: adjust the approach (bigger steps, more deterministic slicing, different
prompts) before going further.

## M2 — Editor shell (M)

- Dockable layout (dockview): Explorer, Monaco editor with tabs, Terminal (xterm.js + portable-pty),
  Output panel.
- Themes: Focus (dark/light) and Sage & Camel, applied to UI, Monaco and xterm.
- Settings screen; AI providers with keys in the OS keychain; model roles.
- Open any folder and edit / run it like a mini IDE.

**Done when**: you can comfortably code a small project inside KnYC on all three OS (Linux
WebKitGTK tested).

## M3 — Learning loop, first alpha (L) → `v0.1.0-alpha`

- Onboarding (the full 3 cards, design 04 §1).
- Import screen with exclusions + an estimate of AI calls and time; live analysis view (pipeline
  from M1, running inside the app).
- Project overview, choose path (track, size, setup toggle); step 1 opens before the whole path is
  prepared.
- Lesson panel: goal, lazy lesson, checks + run, "explain this failure", hint ladder, reveal diff,
  step chat.
- Progress, snapshots (`snapshots.git`), skip with warning, step complete.
- Scope: **TS/JS backend (Express) track**, plus **Full project** for simple Node projects.
  **Claude Code CLI only** (API-key providers later).

Issues (milestone "M3 — Learning loop"), in dependency order: #55 pipeline host in the app ·
#56 Claude Code calls from the app · #57 analysis jobs (background, resumable) · #58 onboarding ·
#59 import screen · #60 live analysis + project overview · #61 choose path + progressive
preparation · #62 lesson panel + checks · #63 hint ladder + reveal diff · #64 explain this failure +
step chat · #65 progress, snapshots, skip, path map · #66 alpha check + v0.1.0-alpha.

**Done when**: a learner can rebuild a golden repo from start to finish in the app.

## M4 — Tracks & JS frameworks (XL) → `v0.2.0-alpha`

Scope decided in **H4**: every track and framework below, Playwright UI checks and the full Docker
mode. When a learner picks one track, the others come from the original code.

- **Foundations**: framework profiles, the track split with contracts (design 02 ④), projects with
  several packages, checks against a running server, Playwright UI checks, Docker checks and the
  Docker mode for every check.
- **Frontend**: React (Vite), Next.js, Vue, Angular, against the original backend.
- **Backend**: NestJS, Fastify (Express already done).
- **Database**: Prisma, TypeORM, Drizzle: migrations apply, queries return the expected data.
- **Deployment**: Dockerfile, docker-compose, CI files (local only: the image builds, the
  container answers, the CI file is valid).
- **Progress per track**: a finished track's code replaces the original for the next one.
- A golden repo for each profile, plus a full-stack one; `knyc eval` on all of them.

Issues (milestone "M4 — Tracks & JS frameworks"), in dependency order:

| # | Issue | Needs |
|---|---|---|
| M4.1 | Step goals rewritten from their proven checks (design/09 follow-up) | — |
| M4.2 | Profile system: detection id, track rules, build order, check strategy, run commands, lesson hints; Express moved to it; generic fallback | — |
| M4.3 | Track split and contracts: units → tracks (profile rules, AI for leftovers), HTTP / DB / env contracts, only existing tracks offered, plan / timeline / checks per track, other tracks from the original | M4.2 |
| M4.4 | Projects with several packages (`apps/web` + `apps/api`, npm / pnpm workspaces): install, build, test per package | M4.3 |
| M4.5 | Server checks: start the project's server, wait for its port, run `http` checks, stop the process tree | M4.2 |
| M4.6 | Playwright UI checks: Chromium downloaded on first use (size shown, consent), `ui` check kind, generated UI tests proven red → green | M4.5 |
| M4.7 | Docker checks: detect Docker, `docker` check kind (build, run, health path), cleanup | M4.2 |
| M4.8 | Docker mode: every check in a container (`settings.runChecksIn = "docker"`) | M4.7 |
| M4.9 | Frontend track: React (Vite) profile + full-stack golden repo (React web + Express API) | M4.3–M4.6 |
| M4.10 | Next.js profile + golden repo (API routes go to the backend track) | M4.9 |
| M4.11 | Vue profile + golden repo | M4.9 |
| M4.12 | Angular profile + golden repo | M4.9 |
| M4.13 | NestJS profile + golden repo | M4.2, M4.5 |
| M4.14 | Fastify profile + golden repo | M4.2, M4.5 |
| M4.15 | Database track: Prisma profile, migration and query checks + golden repo | M4.3 |
| M4.16 | TypeORM and Drizzle profiles + golden repos | M4.15 |
| M4.17 | Deployment track: Dockerfile, compose and CI checks + golden repo | M4.3, M4.7 |
| M4.18 | Progress per track: a finished track's code replaces the original; per-track progress on the overview | M4.3 |
| M4.19 | M4 evaluation (`knyc eval` on every golden repo, design/10) + `v0.2.0-alpha.1` | all |

**Done when**: on every golden repo, each track that exists can be rebuilt in the app, the eval
passes the M1 bar (≥ 80 % of steps with a proven behavior check), and `v0.2.0-alpha.1` is released.

## M5 — More languages (L)

- Python: FastAPI, Django, Flask (pytest).
- Go: net/http, Gin (`go test`).
- C#: ASP.NET Core (xUnit / NUnit).
- tree-sitter grammars + toolchain detection for each.

## M6 — Polish & launch → `v1.0.0` (L)

- Onboarding, path map (timeline + architecture lighting up), track complete summary + export.
- More providers: OpenAI, Gemini, Ollama; CLI connectors (Claude Code / Codex) **only after
  checking each provider's terms**.
- Auto-update (signed update manifests).
- Landing page final: real screenshots in both themes, demo video, FAQ, changelog, privacy, GoatCounter.
- Accessibility pass, performance pass (big repos), error messages, docs.

**Done when**: v1.0.0 released, landing page live, announcement post written.

---

## After v1 (backlog)

- Import from a GitHub URL.
- "Close enough" validation mode (AI-judged).
- French UI (first extra language).
- Code signing (Apple notarization, Windows certificate).
- UI tests (Playwright) as a check type for frontend steps.
- Sharing / exporting learning paths.
- More languages and frameworks (Rust, Java/Spring, PHP/Laravel, Ruby/Rails…), community profiles.

## Working rules for the coding phase

- Each milestone is broken into small issues on GitHub before starting it.
- One branch + pull request per issue; CI must be green on all three OS before merging.
- Design docs are updated when a decision changes; they stay the source of truth.

## Decisions

- **H1 — How we code together**: Claude writes the code for each issue and explains the key parts;
  Alann reviews and tests on their machine before merging.
- **H2 — Golden repos**: purpose-built by Claude inside the repo (`fixtures/golden/`), so they are
  controlled and license-safe:
  1. `express-notes` — small, with tests (~300 LOC).
  2. `express-shop` — medium, with tests, a few modules (~1.5k LOC).
  3. `express-no-tests` — small, no tests at all (exercises generated checks).

  Real open-source repos can be added later as extra fixtures.
- **H3 — M3 scope** (2026-10-22):
  - **AI**: the Claude Code CLI only in the alpha; API-key providers (AI SDK, design 01) come later.
  - **Where the pipeline runs**: `packages/core` stays TypeScript and runs inside the app; every
    process (git, `claude`, knyc-sys steps, builds) goes through Tauri commands in Rust behind a
    host interface, so the CLI (Node) and the app share the same pipeline code. No Node sidecar.
  - **Waiting**: the learner starts step 1 as soon as its checks are ready; later steps are
    prepared in the background (design 02, "Cost, time, privacy").
  - **Onboarding**: the full 3 cards from the alpha on.
  - **Estimate**: with the CLI there is no per-token cost, so the import screen shows the number of
    AI calls and the time, and that it uses part of the Claude plan. A plan limit pauses the
    analysis, which resumes later from the last finished stage.
  - **Lesson extras** all in the alpha: reveal diff, explain this failure, step chat, snapshots + skip.
- **H4 — M4 scope** (2026-10-25):
  - **Scope**: the whole roadmap list in one milestone (every track and framework, Docker mode),
    rather than splitting it. The foundations come first (M4.1–M4.8), so each framework after them
    is mostly a profile and a golden repo.
  - **Frontend checks**: Playwright in a real browser (brought forward from the backlog). Chromium
    only, headless, downloaded into the app data folder the first time a frontend path needs it,
    after showing its size. Like generated checks, the UI tests are copied into the workspace only
    while they run: nothing is added to the learner's `package.json`.
  - **Other tracks**: when the learner picks a track, the others come from the original code (the
    React frontend runs against the real backend). A mock API generated from the contracts stays
    in the backlog, for backends too heavy to run.
  - **Docker**: the Deployment track's checks build and run images, and the optional Docker mode
    runs every check inside a container (no local toolchain needed). Both need Docker installed;
    without it, the Deployment track and the mode are shown as unavailable, with the reason.
  - **Defaults, to confirm in review**: profiles stay in `packages/core/src/profiles` (browser-safe,
    shared by the CLI and the app) instead of a separate `packages/profiles`; golden repos stay
    purpose-built (H2), one per profile plus a full-stack one; database golden repos use SQLite so
    they run without a server (Postgres through the Docker mode); `v0.2.0-alpha.1` at the end, and
    an earlier alpha after M4.9 if the milestone runs long.
