# 01 — Tech stack & architecture

Status: **agreed** (2026-10-21)

## Principle: two layers

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (WebView) — TypeScript + React                     │
│                                                              │
│  UI  ·  Monaco editor  ·  xterm.js terminal  ·  lesson panel │
│  App logic: tracks, steps, progress, hints                   │
│  AI orchestration: prompts, structured output (AI SDK)       │
└───────────────▲──────────────────────────────┬───────────────┘
                │ events (PTY output,          │ commands (invoke)
                │ check results, file changes) │
┌───────────────┴──────────────────────────────▼───────────────┐
│  Backend (native) — Rust / Tauri 2                           │
│                                                              │
│  Filesystem & workspaces  ·  PTY (terminal)                  │
│  Process runner (builds, tests, dev servers, Docker)         │
│  Code analysis (tree-sitter)  ·  Keychain (API keys)         │
│  HTTP proxy for AI calls  ·  CLI connectors (claude, codex)  │
└──────────────────────────────────────────────────────────────┘
```

- **Rust = the system layer**: anything that touches the OS, files, processes or secrets.
- **TypeScript = the brain and the face**: app logic, AI prompts, UI.
- They talk through Tauri **commands** (TS calls Rust) and **events** (Rust pushes to TS).

## Stack

| Piece | Choice | Notes |
|---|---|---|
| Desktop shell | **Tauri 2** | Small downloads (~10–15 MB). Uses the OS WebView: WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux). |
| Backend language | **Rust** | Close to C in spirit; used only for the system layer. |
| Frontend language | **TypeScript** | |
| UI | **React + Tailwind** | |
| Editor | **Monaco** | Works in all three WebViews. |
| Terminal | **xterm.js** (front) + **portable-pty** (Rust) | Same PTY crate family WezTerm uses; cross-platform incl. Windows ConPTY. |
| Process runner | Rust `std::process` / `tokio::process` | Streams stdout/stderr as events; timeouts; kill on cancel. |
| Code analysis | **tree-sitter** (Rust crates) | Grammars: TS/JS/TSX, Python, Go, C#, HTML, CSS, JSON, YAML, Dockerfile. Fast and native. |
| AI layer | **Vercel AI SDK** (TS) + **tauri-plugin-http** | AI SDK gives one API for Claude / OpenAI / Gemini / Ollama with typed structured output. Requests go through Rust's HTTP client (custom `fetch`) → no CORS issues, keys never live in the WebView longer than needed. |
| CLI connectors | Rust spawns `claude` / `codex` in headless mode | Exposed to TS as one more "provider". ⚠️ Check provider terms before shipping (see VISION §7). |
| Secrets | **keyring** crate | macOS Keychain, Windows Credential Manager, Linux Secret Service. |
| Storage | `.knyc/` folder in each workspace, JSON files | Readable, portable, git-friendly. SQLite later only if needed. |
| i18n | **i18next** | `locales/en.json` now; one file per new language. |
| Packaging | Tauri bundler + **tauri-action** (GitHub Actions) | `.dmg` / `.app`, `.msi` / `.exe`, `.AppImage` / `.deb` / `.rpm`. |
| Auto-update | **tauri-plugin-updater** + GitHub Releases | Signed update manifests. |
| Landing page | **Astro** + Tailwind, on GitHub Pages | Detects visitor OS, links the latest release assets. |
| Monorepo | **pnpm workspaces** + Cargo workspace | See layout below. |
| Tests | Vitest (TS), `cargo test` (Rust), Playwright later | |

## Repo layout

```
KnYC/
├─ apps/
│  ├─ desktop/
│  │  ├─ src/              # React frontend
│  │  └─ src-tauri/        # Rust backend (Tauri app)
│  └─ landing/             # Astro site
├─ packages/
│  ├─ core/                # TS: path generation, step engine, prompts, schemas
│  ├─ profiles/            # TS: framework profiles (react, nextjs, nestjs, …)
│  └─ ui/                  # shared React components (optional)
├─ crates/
│  ├─ knyc-analyzer/       # Rust: tree-sitter parsing, dependency graph
│  └─ knyc-runner/         # Rust: process runner, PTY, sandbox options
├─ design/                 # these design docs
├─ VISION.md
└─ README.md
```

## Workspace model

Importing a project never modifies it. KnYC works with two folders:

- **Source** — the original project, read only.
- **Workspace** — where the learner rebuilds. Created by KnYC, contains `.knyc/`:

```
my-workspace/
├─ .knyc/
│  ├─ project.json      # source path, detected languages / frameworks, tracks
│  ├─ paths/<track>.json# generated learning path per track
│  ├─ progress.json     # current step, hints used, reveals used
│  ├─ checks/           # generated checks, validated against the original
│  └─ snapshots/        # learner code at each completed step
└─ …learner's code…
```

## Running untrusted code

Checks and learner code run on the user's machine, like in any IDE.

- v1: run locally, with a clear warning when importing a project from an unknown source; timeouts and
  process-tree kill on every run.
- Optional **Docker mode** (when Docker is installed): run checks inside a container — also the natural
  home for the Deployment track.

## Distribution caveats (later, but know now)

- **macOS**: without an Apple Developer account ($99/year) for signing + notarization, users get a
  Gatekeeper warning and must right-click → Open. Fine for early versions; document it on the landing page.
- **Windows**: unsigned installers trigger SmartScreen "unknown publisher". Same approach: document it,
  sign later.
- **Linux**: no signing issue; AppImage works everywhere, `.deb` / `.rpm` for package managers.
- **WebView differences**: test Monaco and xterm.js on WebKitGTK (Linux) early — it is the least
  polished of the three.
