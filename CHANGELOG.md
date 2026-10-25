# Changelog

What changed in each KnYC release. The release workflow copies a version's section into its
GitHub release, so keep one `## [version]` heading per release.

## [0.1.0-alpha.1] - 2026-10-25

The first alpha: the whole learning loop works. Import a TypeScript / JavaScript backend (Express)
or a simple Node project, and rebuild it step by step in the app, with real checks and an AI
guide. AI runs through your own Claude Code CLI login (API keys and other providers come later).

### Learn a project

- **Onboarding** in three cards: what KnYC does, your tools (Node, npm, git), your AI (Claude Code).
- **Import** a folder, with exclusions and an estimate of AI calls and time before anything runs.
- **Analysis** in the background, resumable, with a live view: scan, code graph, summaries, then
  the path. It pauses on a usage limit and resumes when it resets.
- **Project overview**: stack, summary, architecture map and tracks (Backend, Full project).
- **Choose a path**: track, size (overview, standard, deep) and setup. Step 1 opens before the
  whole path is ready.
- **Lessons** written for each step, including what its checks expect.
- **Checks** that really run your code: the project's own tests, plus checks generated for the
  step and proven to fail before it and pass after it.
- **When you're stuck**: a hint ladder (three levels), "Explain this failure", a chat per step,
  and "Reveal original" with a diff against your code.
- **Progress**: step complete, a snapshot of your code after every passed step (your own `.git`
  stays untouched), skip with a warning, and a path map.

### Editor shell

- Home with recent workspaces, a dockable layout, Explorer, Monaco editor, terminal, Run panel
  for the project's scripts, Settings (keys in the OS keychain), command palette and shortcuts.

### Known limits

- Backend Express projects and simple Node projects only; other stacks come in later milestones.
- Claude Code CLI only, and the builds aren't signed (see the README to open them).
- A step's goal may not name everything its checks call; the lesson's "What the checks expect"
  list does.

## [0.0.1] - 2026-10-21

- Foundations: monorepo, desktop shell, landing page and CI.
