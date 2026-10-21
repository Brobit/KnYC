# 04 — UI & screens

Status: **agreed** (2026-10-21) — decisions at the end.

## Principles

- **Feels like an IDE, teaches like a course.** Developers should feel at home (VS Code-like layout,
  shortcuts), but the lesson is always one glance away.
- **The learner always knows three things**: where they are (step / milestone), what to do now (goal),
  and how to know they're done (checks).
- **Help is a ladder, not a button**: hint 1 → hint 2 → hint 3 → reveal. Each rung is visible and counted.
- **Show the architecture growing**: the project map lights up as steps are passed.
- Keyboard first: command palette, shortcuts for run checks / next hint / next step.
- Every string goes through i18next (`t("lesson.runChecks")`), no hard-coded text.

## Screen map

```
First launch ─► Onboarding (AI + toolchains)
                     │
                     ▼
                   Home ◄──────────────────────────────┐
           (recent workspaces, import)                 │
                     │                                 │
                     ▼                                 │
              Import project                           │
     (source, workspace, exclusions, estimate)         │
                     │                                 │
                     ▼                                 │
               Analysis (live) ─► Project overview     │
                                  (map + tracks)       │
                                        │              │
                                        ▼              │
                                  Choose path          │
                             (track, size, setup)      │
                                        │              │
                                        ▼              │
                            ┌──► Learning workspace ───┤
                            │   ├ Reveal diff (modal)  │
                            │   ├ Path map (view)      │
                            │   └ Step complete        │
                            └────────────┘             │
                                  Track complete ──────┘

Settings: reachable from everywhere (⌘/Ctrl + ,)
```

---

## 1. Onboarding (first launch)

Three short cards, skippable after the first:

1. **Welcome** — one sentence on what KnYC does, one animation of the loop.
2. **Connect an AI** — options:
   - API key: Claude / OpenAI / Gemini (paste, test connection, stored in keychain).
   - Local CLI: shows "Claude Code detected ✓" / "Codex detected ✓" if found on PATH.
   - Ollama: detects a local server and lists models.
   - Then pick models for the three roles (summaries / planning / lessons) with sensible defaults.
3. **Toolchains** — table of Node / Python / Go / .NET / Docker: found version or "not found" +
   install link. Not blocking; checked again per project.

## 2. Home

```
┌───────────────────────────────────────────────────────────┐
│  KnYC                                         ⚙  Settings  │
├───────────────────────────────────────────────────────────┤
│                                                           │
│   [ + Import a project ]                                  │
│                                                           │
│   Continue                                                │
│   ┌─────────────────────────┐ ┌─────────────────────────┐ │
│   │ my-nest-api             │ │ todo-next               │ │
│   │ Backend · Standard      │ │ Frontend · Overview     │ │
│   │ ████████░░░░ 8/15       │ │ ██░░░░ 1/5              │ │
│   │ Next: JWT guard         │ │ Next: Todo list page    │ │
│   └─────────────────────────┘ └─────────────────────────┘ │
│                                                           │
│   Recent · All workspaces                                 │
└───────────────────────────────────────────────────────────┘
```

## 3. Import project

One page, three sections:

- **Source folder** (picker, read only) → instant static scan (no AI): languages, frameworks, size.
- **Workspace folder** (default: `~/KnYC/<project-name>`).
- **What will be sent to the AI**: file count, excluded files list (secrets, ignored, binaries) with
  reasons, approximate tokens / cost for API-key providers. **[Start analysis]**.

## 4. Analysis (live)

Vertical list of pipeline stages (design 02) with status, timing and a one-line result each
("Found 3 tracks", "42 files summarized"). Cancel at any time. When planning is done for one track,
a "Start learning" button appears while later steps keep preparing.

## 5. Project overview

```
┌──────────────────────────────────────────────────────────────┐
│ my-nest-api · TypeScript · NestJS 10 · Prisma · Docker       │
├───────────────────────────────┬──────────────────────────────┤
│                               │  Tracks                      │
│      Architecture map         │  ┌────────────────────────┐  │
│   (modules as boxes, arrows   │  │ Backend   2.1k LOC  ~6h│  │
│    = dependencies, colored    │  ├────────────────────────┤  │
│    by track)                  │  │ Database  300 LOC   ~1h│  │
│                               │  ├────────────────────────┤  │
│   AppModule ─► UsersModule    │  │ Deployment 80 LOC  ~1h │  │
│        └──► AuthModule        │  ├────────────────────────┤  │
│                               │  │ Full project       ~8h │  │
│                               │  └────────────────────────┘  │
│  Project summary (AI, 1 para) │  [ Choose a path → ]         │
└───────────────────────────────┴──────────────────────────────┘
```

## 6. Choose path

- Track (cards, from the overview).
- Size: **Overview ~5 · Standard ~15 · Deep dive ~40** steps, with estimated time.
- Toggle: "Teach project setup as the first step".
- Shared code: "Provide it" / "Teach it in this track".
- Other tracks: provided by original code / mock (shown, editable).
- **[Generate path]** → back to the live analysis view for stages ⑥–⑧.

## 7. Learning workspace (main screen)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◀ my-nest-api · Backend · Standard   ●●●●●●●○○○○○○○○  s08/15   ⌘K   ⚙    │ ← top bar: path progress
├────┬───────────────┬─────────────────────────────────┬───────────────────┤
│ 📁 │ EXPLORER      │ users.service.ts  auth.guard.ts │ STEP 8 · Auth     │
│ 🗺 │ src/          │                                 │ JWT guard         │
│ 🔍 │  app.module   │   (Monaco editor)               │                   │
│ ⎇  │  users/       │                                 │ Goal              │
│    │ ● auth/       │                                 │ Protect /users    │
│    │   auth.guard ✎│                                 │ routes with a JWT │
│    │               │                                 │ guard.            │
│    │ ● = touched   │                                 │                   │
│    │   this step   │                                 │ Lesson (md)       │
│    │               │                                 │ …                 │
│    │               ├─────────────────────────────────┤ Checks      ▶ Run │
│    │               │ TERMINAL │ CHECKS │ OUTPUT       │ ✓ app builds      │
│    │               │ $ npm run start:dev             │ ✗ GET /users 401  │
│    │               │                                 │ ○ valid token 200 │
│    │               │                                 │                   │
│    │               │                                 │ Help              │
│    │               │                                 │ [Hint 1][2][3] 👁  │
│    │               │                                 │ Ask about step…   │
└────┴───────────────┴─────────────────────────────────┴───────────────────┘
```

- **Activity bar** (far left): Explorer · Path map · Search · Snapshots.
- **Explorer**: files touched by the current step are marked; provided (non-track) files shown dimmed
  and read only, with a lock icon.
- **Editor**: Monaco, tabs, diagnostics from the build output where possible.
- **Bottom panel**: Terminal (real shell in the workspace) · Checks (detailed results, expected vs
  actual) · Output (dev server logs).
- **Lesson panel** (right, resizable, collapsible):
  - Step title, milestone, goal, concepts as chips.
  - Lesson (Markdown, code samples, "where this fits" note).
  - Checks list with one **Run** button (⌘/Ctrl + Enter). Failing check → **"Explain this failure"**.
  - Help ladder: Hint 1 · Hint 2 · Hint 3 · 👁 Reveal original (confirm dialog, counted).
  - Step chat: ask questions about this step; the AI sees the step, the lesson and your diff.
- **All checks green** → "Step complete" card: snapshot saved, stats, **[Next step →]**.

### 7a. Reveal original

Monaco diff editor: `R(k-1) → R(k)` per file. Option "compare with my code" (learner vs reference).
Banner: "Revealed — counted in your stats". Button "Apply to my workspace" (asks for confirmation,
learner's version kept in snapshots).

### 7b. Path map

Two views, toggle:

- **Timeline**: milestones and steps, status icons (passed / current / locked / skipped), hints and
  reveals per step. Click a passed step to view its snapshot.
- **Architecture**: the project map from the overview; modules built so far are colored, the rest grey.

### 7c. Track complete

Summary: time, attempts, hints, reveals, concepts learned, architecture map fully lit.
Actions: start another track (your code now replaces the original for this track) · export a short
Markdown recap · back home.

## 8. Settings

Sections: AI providers & model roles · Editor · Checks (local / Docker, timeouts) · Privacy
(exclusion patterns, cost confirmation) · Appearance (theme, language) · About / updates.

---

## Movable panels

Every panel of the learning workspace (Explorer, Lesson, Terminal / Checks / Output, Path map) is
**dockable**: drag it by its header to the left, right or bottom, stack panels as tabs, resize or
collapse them. Default layout = the one above (lesson on the right).

- Library: **dockview** (React docking layout, drag-and-drop, serializable).
- The layout is saved in `settings.json` (`layout` field) and can be reset from the command palette
  ("Reset layout").

## Visual style

All colors come from design tokens (CSS variables), so a theme is just a set of token values.
Monaco and xterm.js get matching themes generated from the same tokens.

Themes shipped in v1:

| Theme | Mood | Palette |
|---|---|---|
| **Focus** (default) | Calm, IDE-like | Neutral greys, one cool accent (blue/teal); dark and light variants |
| **Sage & Camel** | Very calm, soft | Pastel sage green + camel / sand on warm off-white (light) or warm charcoal (dark); low contrast surfaces, still AA-readable text. Camel = action color, sage = success (see design 07) |

Shared rules:

- Green / red reserved for check results — in Sage & Camel, check green is a deeper sage and
  red a muted terracotta so they don't clash with the pastels.
- Track colors (maps and chips): Frontend, Backend, Database, Deployment — four distinct hues per theme.
- Font: system UI for the interface, a monospace (JetBrains Mono / system mono) for code.
- Component library: **shadcn/ui** (Radix + Tailwind) — accessible, themable through the same tokens.
- More themes later = one new token file.

## Decisions

- **F1 — Lesson panel**: right by default; all panels movable (see "Movable panels").
- **F2 — Visual identity**: "Focus" by default, plus the pastel "Sage & Camel" theme.
- **F3 — Navigation**: learners can jump to a locked step after a warning. Skipped steps are marked
  "skipped" and their reference code is applied so the project still builds (learner's previous code
  kept in snapshots).
