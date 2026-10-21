# KnYC — Know Your Code

> Import any codebase. Rebuild it step by step, with an AI guide. Understand it end to end.

Status: **design complete** — see [`design/`](design/). Next: coding, starting with M0 (design 06).

Design docs:
1. [Tech stack & architecture](design/01-architecture.md) — agreed
2. [Analysis pipeline](design/02-analysis-pipeline.md) — agreed
3. [Data model](design/03-data-model.md) — agreed
4. [UI & screens](design/04-ui-screens.md) — agreed
5. [Landing page](design/05-landing-page.md) — agreed
6. [Roadmap](design/06-roadmap.md) — agreed
7. [Design system](design/07-design-system.md) — draft for review (visuals in [`design/knyc.pen`](design/knyc.pen))

---

## 1. The idea

KnYC is a cross-platform desktop app (macOS, Linux, Windows) that turns any local codebase into a
personal "build your own X" course:

1. **Import** a code folder.
2. **Analyze** it with an AI (architecture, dependencies, entry points, a sensible build order).
3. **Generate a learning path**: an ordered list of steps that rebuild the project from an empty folder.
4. **Guide** the learner through each step: explain what to build and why, the learner writes the
   code in the built-in editor, the app runs checks, the AI gives hints when they fail.
5. At the end, the learner has rebuilt the project themselves and understands the code, the steps
   and the architecture.

A landing page lets people download the app for each OS.

### Goal

Open source / portfolio project, licensed **GPL-3.0**. Free, published on GitHub, releases linked from
the landing page.

### Target users

- **Students / learners** (e.g. 42 students) rebuilding projects to learn.
- **Developers onboarding** onto an existing codebase at a new job.
- **Self-taught developers** rebuilding open-source projects.

### What already exists, and why KnYC is different

| Product type | Examples | Limitation |
|---|---|---|
| "Rebuild X" courses | CodeCrafters, Build Your Own X, Boot.dev | Fixed, hand-written projects — you can't bring your own repo |
| AI repo explainers | DeepWiki, Greptile, Cursor / Copilot "explain" | Passive — you read, you don't rebuild |

**KnYC = any repo + active rebuilding + automatic checks.**

---

## 2. MVP (v1) scope

| | v1 |
|---|---|
| **Platforms** | macOS, Linux, Windows desktop app + landing page with downloads |
| **Import** | Local folder only |
| **Languages** | TypeScript / JavaScript, Python, Go, C#, HTML / CSS |
| **Frameworks (bonus)** | React, Next.js, Vue, Angular, NestJS, and similar — see §6 |
| **AI** | Bring your own: API key (Claude, OpenAI, Gemini), local-CLI connector (Claude Code / Codex) where terms allow, Ollama optional |
| **Tracks** | The user picks what to rebuild: Frontend, Backend, Deployment, or Full project — see §3 |
| **Path size** | Chosen by the user: Overview (~5 steps), Standard (~15), Deep dive (~40) |
| **Validation mode** | Strict: the learner's code must pass the same checks as the original |
| **Editor** | Built in: file tree, code editor, terminal, lesson / AI panel |
| **Reveal original** | Button to reveal the original code for the current step (counted as a hint) |
| **Progress** | Saved locally, resumable, one snapshot per completed step |
| **UI language** | English only, but all UI strings go through an i18n layer so other languages can be added |

### Out of v1 (later)

- Import from a GitHub URL
- "Close enough" validation mode (AI judgment instead of checks)
- Accounts / cloud sync
- Multiplayer / sharing paths
- More UI languages (French first)

---

## 3. Tracks: choose what to rebuild

After the analysis, the app splits the project into **tracks** and the learner picks which one to work
on first:

| Track | Covers | Example checks |
|---|---|---|
| **Frontend** | UI, components, routing, state, API calls | Unit tests, build, (later) UI tests |
| **Backend** | API, business logic, auth, data access | Tests, HTTP requests against the running server |
| **Database** | Schema, migrations, seeds | Migrations apply, queries return expected data |
| **Deployment** | Dockerfile, docker-compose, CI/CD, env config | `docker build` succeeds, container starts and answers, CI file is valid |
| **Full project** | Everything, in a natural order | All of the above |

Rules:

- **Only the tracks that exist are offered.** A CLI tool has no frontend; a static site has no backend.
  The app detects them during analysis.
- **The rest is provided.** When the learner picks one track, the parts they didn't pick come from the
  original code, so the project still runs. Example: rebuild the frontend against the original
  backend. If running the real part is too heavy, the app can use a mock instead (e.g. a fake API).
- **Progress is per track.** Finish the backend today, start the frontend next week; the backend you
  wrote replaces the original one.
- **Deployment stays local in v1.** Checks prove it *would* deploy (image builds, container runs,
  CI config validates). Real deployment to a cloud provider needs accounts and costs — later.
- Path size (Overview / Standard / Deep dive) applies per track.

---

## 4. The learning loop (one step)

```
Step goal + explanation
        │
        ▼
Learner writes code in the built-in editor
        │
        ▼
Run checks ──── pass ───► snapshot, next step
        │
       fail
        │
        ▼
AI explains what failed + progressive hints
(last resort: "reveal original for this step")
```

---

## 5. How checks work ("pass the same checks")

For each step the app needs something runnable that validates the learner's code, in this order of
preference:

1. **The repo's own tests**, limited to the ones relevant to this step.
2. **Generated checks**: the AI writes small tests or "run this command, expect this output" based on
   what the original code does at that stage. The app **runs them against the original first** to
   prove they are valid before showing them to the learner.
3. **Build / compile succeeds**, the minimum for pure setup steps.

The learner needs the language toolchain installed (Node, Python, Go, .NET…). The app detects it and
says what is missing.

---

## 6. Frameworks (bonus for v1)

Frameworks are not new languages — they are TypeScript / JavaScript (or Python, C#…) with their own
structure and tooling. KnYC supports them through **framework profiles**: small, pluggable modules
that tell the app how a given framework works.

A profile describes:

- **Detection** — how to recognize it (e.g. `next` in `package.json`, `angular.json`, `nest-cli.json`).
- **Architecture hints** — what to explain (Next.js routing and server components, NestJS modules /
  controllers / providers, Angular modules and DI, Vue components and stores…).
- **Natural build order** — e.g. NestJS: bootstrap → module → controller → service → DB → guards.
- **Check strategy** — how to validate a step: unit tests (Jest / Vitest), build (`next build`,
  `ng build`), HTTP checks against a running dev server (API routes, NestJS endpoints), and later
  UI checks (Playwright) for frontend steps.

Target profiles for v1, in priority order:

1. React (Vite)
2. Next.js
3. NestJS
4. Express / Fastify
5. Vue
6. Angular
7. Python: FastAPI, Django, Flask
8. Go: net/http, Gin
9. C#: ASP.NET Core

If time runs short, v1 ships the first few and the profile system makes the rest easy to add
(including by contributors).

---

## 7. AI providers

- **API keys** (Claude, OpenAI, Gemini…): the clean, always-allowed path. Keys are stored on the
  user's machine in the OS keychain, never sent anywhere except the provider.
- **Local CLI connector** (Claude Code, Codex CLI): lets subscribers use their plan. The user logs
  into the official CLI themselves; KnYC never handles their credentials.
  ⚠️ Anthropic does not allow third-party apps to offer Claude.ai login / subscription limits without
  approval. **Verify each provider's current terms before shipping this connector.**
- **Ollama** (optional): free local models.

### Why it's more than "a prompt problem"

The prompts are the brain; the app makes the brain reliable:

- **Big repos don't fit in a prompt** → map the project first (tree, imports, entry points), then feed
  the AI only what each step needs.
- **The curriculum is structured data**, not chat → steps, goals, files, checks, stored and displayed.
- **Checks are run, not guessed** → build / tests / commands executed locally, AI explains failures.
- **State** → progress, snapshots, hints used.

---

## 8. Open questions for the design phase

- Tech stack (desktop shell, editor component, language of the core).
- How the repo analysis and step slicing works in detail (the hardest part).
- Format of a learning path (schema).
- Sandboxing: running learner code and generated checks safely.
- UI layout and screens.
- Landing page: stack, hosting, download / auto-update.
- Hint system: levels, cost in "hints used".
