# KnYC — Know your code

Import any project and rebuild it step by step, with an AI guide and real checks.
Understand every line, every step, and the architecture.

> **Status:** early development. The analysis pipeline works (milestone M1, see the
> [evaluation](design/08-m1-evaluation.md)) and the desktop editor shell is nearly done (M2: Home,
> Explorer, editor, terminal, Run panel, settings, command palette). The learning loop comes in M3:
> nothing to learn with yet. See the [vision](VISION.md), the [roadmap](design/06-roadmap.md) and the
> [design docs](design/).

## Download

Installers for macOS, Windows and Linux are on the [releases page](https://github.com/Brobit/KnYC/releases)
and on the [website](https://brobit.github.io/KnYC/).

The builds aren't signed yet:

- **macOS**: right-click the app → **Open**, then confirm.
- **Windows**: on the SmartScreen warning, click **More info** → **Run anyway**.

## Repository layout

```
apps/desktop      Tauri 2 app — React + Tailwind frontend, Rust backend (src-tauri/)
apps/cli          knyc analyze / knyc eval: the analysis pipeline from the command line
apps/landing      Astro website, deployed to GitHub Pages
packages/core     Schemas (Zod), AI layer and pipeline: summaries, plan, timeline, checks
packages/tokens   Design tokens (CSS variables) shared by the app and the website
crates/           Rust: knyc-analyzer (scan, code graph), knyc-runner (commands, checks,
                  terminals), knyc-sys (CLI the pipeline calls)
fixtures/golden/  Small Express projects the pipeline is tested on
design/           Vision, design docs and the Pencil design file (knyc.pen)
```

## Development

Requirements: Node 22+, pnpm (`corepack enable pnpm`), Rust (stable, via [rustup](https://rustup.rs)),
and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm dev            # run the desktop app
pnpm landing:dev    # run the website
pnpm typecheck
pnpm test
cargo test --workspace
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[GPL-3.0](LICENSE)
