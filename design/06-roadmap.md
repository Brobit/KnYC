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

## M4 — Tracks & JS frameworks (XL)

- Framework profile system (`packages/profiles`) and the other tracks:
  - **Frontend**: React (Vite), then Next.js, Vue, Angular — with provided backend or mock API from
    contracts.
  - **Backend**: NestJS, Fastify (Express already done).
  - **Database**: Prisma / TypeORM / Drizzle migrations and query checks.
  - **Deployment**: Dockerfile, docker-compose, CI file checks (local only).
- Optional Docker mode for running checks.
- Golden repos for each profile.

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
