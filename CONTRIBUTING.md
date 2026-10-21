# Contributing to KnYC

Thanks for your interest! KnYC is early, so the design docs in [`design/`](design/) are the
source of truth. Read [VISION.md](VISION.md) and [the roadmap](design/06-roadmap.md) first.

## Workflow

1. Open (or pick) an issue. Each roadmap milestone is split into small issues.
2. Create a branch from `main`: `m<milestone>/<short-name>` (e.g. `m1/static-scan`).
3. Keep pull requests small and focused. CI must be green on macOS, Windows and Linux.
4. If your change alters a design decision, update the matching file in `design/` in the same PR.

## Checks to run before pushing

```bash
pnpm typecheck
pnpm --filter @knyc/desktop build
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Code style

- TypeScript: strict mode, no hard-coded UI strings — every string goes through i18next
  (`apps/desktop/src/locales/en.json`).
- Colors only from design tokens (`packages/tokens/tokens.css`), never raw hex in components.
- Rust: `rustfmt` defaults, no `clippy` warnings.

## Releases

Bump the version in `apps/desktop/package.json`, then push a tag `vX.Y.Z`. The Release workflow
builds every platform into a draft release; check it and publish it on GitHub. Publishing
rebuilds the website.

## License

By contributing, you agree that your contributions are licensed under [GPL-3.0](LICENSE).
