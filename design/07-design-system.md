# 07 — Design system

Status: **draft for review** (2026-10-21). Source of truth for visuals: [`knyc.pen`](knyc.pen) (Pencil).

## Boards in `knyc.pen`

| Board | Content |
|---|---|
| Palette · Focus light / dark | Color tokens, default theme |
| Palette · Sage & Camel light / dark | Color tokens, pastel theme |
| Typography & spacing | Type scale, spacing scale, radii |
| Components | Reusable components (Focus light) |
| Components · Sage & Camel light / dark, Focus dark | Same components rendered in the other themes (theme check) |
| Screen · Learning workspace (+ Sage & Camel light copy) | Main screen, design 04 §7 |
| Screen · Home | Continue cards, all workspaces, AI roles, toolchains |
| Screen · Import project | Source / workspace folders, quick scan, what's sent to the AI, estimate |
| Screen · Analysis (live) | 9 pipeline stages, tracks found so far, plan preview |
| Screen · Project overview | Stack, AI summary, architecture map colored by track, tracks |
| Screen · Choose path | Track, size, options, summary + "Generate my path" |
| Screen · Reveal diff | Modal over the workspace: step diff `s07 → s08`, files, "Apply to my workspace" |
| Screen · Settings | AI providers (keys, Ollama, CLI with terms warning), model per role |
| Screen · Onboarding (Sage & Camel light) | Step 2 of 3, connect an AI |
| Landing · Home (Sage & Camel light) | Full landing page: hero, how it works, real checks (dark), features, tracks, stack and AI, FAQ, final CTA, footer |

Screenshots used by the landing page are exported to [`assets/`](assets/).

App chrome component: **App bar** (logo, breadcrumb, AI status, settings) used on every screen
except the learning workspace, which has its own top bar with path progress.

## Theme model

Two theme axes, exactly as they will exist in code (CSS variables + `data-theme` / `data-mode`):

- `theme`: `focus` | `sage-camel`
- `mode`: `light` | `dark`

Every color in the app, Monaco and xterm.js comes from these tokens. Adding a theme = one new set of values.

## Color tokens

| Token | Focus light | Focus dark | Sage & Camel light | Sage & Camel dark | Use |
|---|---|---|---|---|---|
| `bg` | `#F6F7F9` | `#0F1115` | `#F5F1E8` | `#1C1A17` | App background |
| `surface` | `#FFFFFF` | `#161920` | `#FBF8F2` | `#24221E` | Cards, panels |
| `surface-2` | `#EFF1F4` | `#1C2029` | `#EEE7DA` | `#2B2823` | Sidebars, panel headers |
| `surface-editor` | `#FFFFFF` | `#12151B` | `#FCFAF5` | `#201E1A` | Editor, terminal |
| `border` | `#E2E5EA` | `#252A34` | `#E3DACA` | `#37332C` | Hairlines |
| `border-strong` | `#C9CED6` | `#363C48` | `#CDBFA8` | `#4A443B` | Inputs, outlined buttons |
| `text-primary` | `#14171C` | `#E8EBF0` | `#2D2A24` | `#EDE7DB` | Body text |
| `text-secondary` | `#545C68` | `#A4ACB8` | `#5E584D` | `#BAB2A2` | Supporting text |
| `text-muted` | `#868D98` | `#6E7682` | `#8C8474` | `#878070` | Meta, placeholders |
| `accent` | `#3A6FD8` | `#6E9DF2` | `#8C6539` | `#D4AB7B` | Action, current step, focus |
| `accent-soft` | `#E7EEFB` | `#1C2944` | `#F2E5D3` | `#3D3124` | Selected / current backgrounds |
| `on-accent` | `#FFFFFF` | `#0F1115` | `#FFFFFF` | `#1C1A17` | Text on `accent` |
| `accent-2` | `#22918A` | `#4FC4BA` | `#5B7A56` | `#A6C29F` | Concepts, secondary highlights |
| `accent-2-soft` | `#E0F3F1` | `#15322F` | `#E2EADC` | `#2E3A2B` | Concept chips |
| `success` | `#1E8653` | `#52C38D` | `#3B7F45` | `#8ACF85` | Passed checks / steps |
| `success-soft` | `#E2F3E9` | `#15301F` | `#E0EAD9` | `#263322` | |
| `danger` | `#C4413A` | `#F2766E` | `#B2563E` | `#E28F77` | Failed checks |
| `danger-soft` | `#FBE8E6` | `#3A1C1B` | `#F5E1D9` | `#3D2620` | |
| `warning` | `#A86F12` | `#E3AA4C` | `#A27526` | `#DEB668` | Weak checks, warnings |
| `warning-soft` | `#FBF0DC` | `#3A2C14` | `#F3E7CD` | `#3A301C` | |
| `track-frontend` | `#7457CF` | `#A78EF2` | `#8573B4` | `#B6A8DD` | Track color |
| `track-backend` | `#16897E` | `#47C3B6` | `#4B867B` | `#88C1B6` | Track color |
| `track-database` | `#B8741A` | `#E4A64D` | `#AC7A42` | `#DAA970` | Track color |
| `track-deployment` | `#C04F84` | `#E88AB5` | `#B0647C` | `#DD9CB0` | Track color |

**Sage & Camel role choice**: **camel is the action color** (buttons, current step) and **sage is
"done / good"** (success) plus concept chips. With sage as the accent, "current step" and "passed
step" were indistinguishable in the progress bar.

## Typography

- UI: **Inter**. Code: **JetBrains Mono**.
- IDE-density scale:

| Token | Size / weight | Use |
|---|---|---|
| display | 28 / 600 | Landing-style titles, onboarding |
| h1 | 22 / 600 | Screen titles |
| h2 | 17 / 600 | Section / step titles |
| h3 | 14 / 600 | Panel sections |
| body | 13 / 400 | Default UI and lesson text |
| small | 12 / 400 | Secondary info |
| label | 11 / 600, +0.6 letter-spacing, uppercase | Panel headers, section labels |
| code | 13 mono | Editor, check output |
| code-sm | 12 / 11 / 10 mono | File tree, meta, durations |

## Spacing & radius

- Spacing: `space-1..8` = 4, 8, 12, 16, 24, 32 px.
- Radius: `radius-sm` 4 (chips, tree rows) · `radius-md` 6 (buttons, inputs) · `radius-lg` 10 (cards, panels).
- No shadows inside the app chrome; separation by surfaces and 1 px borders. Shadows only for
  floating layers (menus, dialogs, dragged panels).

## Components

| Component | States / variants |
|---|---|
| Button | Primary · Secondary · Ghost (icon + label, 30 px high) |
| Chip/Concept | Concept tags on a step |
| Badge/Track | Dot in track color + name |
| Badge/Status | Weak check · Skipped · Revealed |
| Tab | Active (accent underline) · inactive |
| Input, Toggle | API key field, settings toggles |
| Check row | Pass · fail (tinted row) · running · pending; failure detail block with "Explain this failure" |
| Hint ladder | Used · next · locked hints, then "Reveal original" |
| Path progress | One segment per step: done (success) · current (accent) · todo |
| Tree row | Normal · provided/locked (muted + lock) · touched this step (accent + dot) · being edited (accent-soft) |
| Track card | Default · selected (2 px accent border) |
| Step item | Passed · current · skipped · locked |
| Panel header | Draggable (grip) dockable panel title |

Icons: **Lucide** (same set as shadcn/ui).
