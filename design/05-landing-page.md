# 05 — Landing page

Status: **agreed** (2026-10-21) — decisions at the end.

## Goal

One job: **make a visitor understand KnYC in 10 seconds and download the right build in one click.**
Secondary: send developers to GitHub (stars, issues, contributions).

## Stack

- **Astro** + Tailwind, static output, in `apps/landing`.
- Same design tokens as the app → same two themes (Focus, Sage & Camel) with a small switcher.
- i18n-ready (Astro i18n routing, `en` only for now), like the app.
- Hosted on **GitHub Pages**, deployed by a GitHub Action on every push to `main` and on every release.
- No JavaScript framework needed; a few small scripts (OS detection, theme switch).

## Downloads

Release assets are built by `tauri-action` (design 01) and attached to GitHub Releases with
**stable, version-free names**, so links never change:

```
https://github.com/<owner>/knyc/releases/latest/download/<asset>
```

| OS | Default asset | Alternatives |
|---|---|---|
| macOS | `KnYC-macos-universal.dmg` (Apple Silicon + Intel in one) | — |
| Windows | `KnYC-windows-x64-setup.exe` | `.msi`, arm64 later |
| Linux | `KnYC-linux-x86_64.AppImage` | `.deb`, `.rpm` |

- Releases are published as **normal releases** (versions `0.x` signal pre-1.0), not GitHub
  "pre-releases": `releases/latest` ignores pre-releases and drafts, so the stable links would break.
  The Release workflow creates a draft; it becomes "latest" once published.
- **OS detection** in the browser (`navigator.userAgentData` with a user-agent fallback) picks the main
  button: "Download for macOS". A link below: "Other platforms".
- Version number and release date are fetched from the GitHub API **at build time** (no client-side
  rate limits); the site is rebuilt on each release.
- Mobile visitors: no download button → "KnYC is a desktop app — send yourself the link" (copy link)
  + GitHub button.
- Checksums (`SHA256SUMS`) linked on the download page.

## Pages

```
/            Home (everything below)
/download    All platforms, checksums, install notes, system requirements
/changelog   Generated from GitHub Releases at build time
/privacy     Short: what stays local, what goes to your AI provider, no app tracking, website analytics
```

Docs stay in the GitHub repo for v1 (README + `docs/`); a `/docs` section can come later.

## Home page sections

```
┌──────────────────────────────────────────────────────────────┐
│ KnYC                       Features  Download  GitHub ★  ◐   │  nav (◐ = theme switch)
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   Know your code.                                            │  1. Hero
│   Rebuild any project step by step, with an AI guide.        │
│                                                              │
│   [  Download for macOS  ]   View on GitHub                  │
│   v0.1.0 · Free and open source · Other platforms            │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │      app screenshot / short looping video            │   │
│   └──────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│  How it works                                                │  2. 4 steps
│  ① Import a folder  ② Pick a track  ③ Code each step         │
│  ④ Checks pass → next step                                   │
├──────────────────────────────────────────────────────────────┤
│  Choose what to learn                                        │  3. Tracks
│  Frontend · Backend · Database · Deployment · Full project    │
├──────────────────────────────────────────────────────────────┤
│  Real checks, not vibes                                      │  4. Key features
│  Help when you need it (hints → reveal)                      │     (3–4 cards, each
│  Watch the architecture light up                             │      with a small visual)
│  A real editor and terminal                                  │
├──────────────────────────────────────────────────────────────┤
│  Works with your stack                                       │  5. Languages &
│  TS/JS · Python · Go · C# · React · Next.js · NestJS · …     │     frameworks (logos)
├──────────────────────────────────────────────────────────────┤
│  Your AI, your keys                                          │  6. AI & privacy
│  Claude · OpenAI · Gemini · Ollama · Claude Code / Codex CLI │
│  Code stays on your machine except what you send to your AI. │
├──────────────────────────────────────────────────────────────┤
│  FAQ                                                         │  7. FAQ
├──────────────────────────────────────────────────────────────┤
│  Download again · GitHub · Changelog · Privacy · License     │  8. Footer
└──────────────────────────────────────────────────────────────┘
```

### Copy (first draft)

- **Hero title**: "Know your code."
- **Subtitle**: "Import any project. Rebuild it step by step with an AI guide — and understand every
  line, every step, and the architecture."
- **How it works**: "Import a folder" · "Pick what to learn" · "Write each step yourself" ·
  "Pass the checks, move on".
- **Features**:
  - *Real checks, not vibes* — each step is validated by tests and real requests, proven against the
    original code.
  - *Help, one rung at a time* — three levels of hints, then reveal the original if you're stuck.
  - *See the big picture* — the architecture map lights up as you build.
  - *A real editor* — Monaco, a terminal, and your project running live.
- **AI & privacy**: "Bring your own AI. KnYC runs on your machine; your code only goes to the AI
  provider you choose, and secrets like `.env` files never leave."

### FAQ (first draft)

- Is it free? → Yes, open source under GPL-3.0.
- Which AI do I need? → An API key (Claude, OpenAI, Gemini), a local model (Ollama), or a supported CLI.
- How much does the AI cost? → Depends on the project size and provider; KnYC shows an estimate first.
- Is my code sent anywhere? → Only to the AI provider you configure. No KnYC server, no tracking in
  the app. (This website counts anonymous page views with GoatCounter, no cookies.)
- macOS says the app can't be opened? → Right-click → Open (until the app is signed).
- Windows SmartScreen warning? → "More info" → "Run anyway" (until the app is signed).
- Which languages are supported? → List + "more coming, contributions welcome".

## Visual design

High-fidelity design: board **Landing · Home** in [`knyc.pen`](knyc.pen), in the Sage & Camel light
theme, with one Sage & Camel dark section ("Real checks") for rhythm. Section order as above,
with "Tracks" moved after "Features" and "Stack" + "AI & privacy" side by side.

## Visuals

- Real screenshots of the app in both themes (switching the site theme swaps them).
- One short looping video (≤ 20 s, muted, `.webm` + `.mp4`): import → pick track → failing check →
  passing check → architecture lights up.
- Until the app exists: the mockups from design 04.

## Performance & quality

- Lighthouse ≥ 95 on all four scores; no layout shift; images in AVIF/WebP with explicit sizes.
- Works without JavaScript (download button falls back to the "all platforms" list).
- Accessible: semantic HTML, keyboard navigation, contrast checked in both themes.
- Open Graph / Twitter card image for sharing.

## Decisions

- **G1 — Domain**: GitHub Pages default URL (`<owner>.github.io/knyc`) for now; a custom domain can be
  added later (CNAME file + DNS) without other changes.
- **G2 — Analytics**: a privacy-friendly, cookieless tool on the **website only** — **GoatCounter**
  (free for open-source / non-commercial, no cookies, no consent banner needed). Page views and
  referrers only. Download counts still come from GitHub release stats. The **app** has no analytics.
  The `/privacy` page and FAQ say exactly this.
- **G3 — License**: **GPL-3.0** for the whole repo (app + landing). Modified versions must stay open
  source. MIT / Apache-2.0 dependencies are compatible with it; check new dependencies' licenses
  before adding them.
