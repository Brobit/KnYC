# 03 — Data model

Status: **agreed** (2026-10-21) — decisions at the end.

Everything KnYC stores, where it lives, and who owns each format.

## Rules

1. **Whoever writes a file owns its type.**
   - Written by Rust (scan, graph, run results) → defined in Rust with `serde`, TypeScript types
     generated with **ts-rs**.
   - Written by TypeScript (paths, progress, lessons, settings) → defined with **Zod** in
     `packages/core`. The same Zod schemas are given to the AI SDK for structured output, so the AI
     returns exactly these shapes.
2. Every JSON file has a `schemaVersion` (integer). `packages/core/migrations` upgrades old files on load.
3. IDs are short, stable strings (`s07`, `chk-s07-2`, `backend`), never array indexes.
4. Code is referenced by **unit IDs**, not line numbers (line numbers change):
   `src/users/users.service.ts#UsersService.create`.
5. Code history (reference timeline, learner snapshots) is stored as **git commits**, using the `git2`
   crate (libgit2) — the user doesn't need git installed.

## Where things live

```
<app data dir>/                      # per user, OS-specific location
├─ settings.json                     # app settings, providers (no secrets)
├─ workspaces.json                   # recent workspaces
└─ cache/<sourceHash>/
   ├─ sandbox/                       # copy of the original, deps installed (design 02 ①)
   ├─ scan.json                      # ② static scan           (Rust)
   ├─ graph.json                     # ③ code graph            (Rust)
   ├─ summaries.json                 # ⑤ summaries, by file hash (TS)
   └─ reference.git/                 # ⑦ reference timeline: one commit per step, tag `<pathId>/sNN`

OS keychain                          # API keys, referenced by `keyRef`

<workspace>/
├─ .knyc/
│  ├─ project.json                   # what this workspace is
│  ├─ paths/<pathId>.json            # one learning path (track + size)
│  ├─ checks/<pathId>/<checkId>.json # check specs
│  ├─ checks/<pathId>/files/…        # generated test files (copied in at run time)
│  ├─ lessons/<pathId>/<stepId>.json # lazily generated lessons, hints, step chat
│  ├─ progress.json                  # where the learner is
│  ├─ runs/<pathId>/<stepId>.jsonl   # check run history (last 50 per step)
│  └─ snapshots.git/                 # learner snapshots, separate from their own .git
└─ …learner's code (may have its own .git, untouched)…
```

---

## Global

### settings.json (TS)

```ts
Settings {
  schemaVersion: 1
  uiLanguage: "en"
  theme: { name: "focus" | "sage-camel", mode: "system" | "light" | "dark" }
  layout?: unknown                      // serialized dockview layout (design 04)
  confirmCostEstimate: boolean          // design 02, D4
  providers: Provider[]
  roles: {                              // which model does what
    summaries: ModelRef                 // cheap
    planning:  ModelRef                 // strong
    lessons:   ModelRef
  }
  editor: { fontSize: number, tabSize: number, vimMode: boolean }
  runChecksIn: "local" | "docker"
}

Provider {
  id: string                            // "anthropic-main"
  type: "anthropic" | "openai" | "google" | "ollama" | "claude-cli" | "codex-cli"
  label: string
  baseUrl?: string                      // Ollama / proxies
  keyRef?: string                       // keychain entry; never the key itself
}

ModelRef { providerId: string, model: string }
```

---

## Workspace

### project.json (Rust writes scan part, TS writes the rest)

```ts
Project {
  schemaVersion: 1
  id: string
  name: string
  source: { path: string, hash: string, gitCommit?: string }
  createdAt: string                     // ISO date
  languages: { id: "typescript" | "javascript" | "python" | "go" | "csharp" | "html" | "css", loc: number }[]
  frameworks: { profileId: string, version?: string, root: string }[]   // root = sub-folder in monorepos
  toolchains: { id: "node" | "python" | "go" | "dotnet" | "docker", required: string, found?: string }[]
  commands: { root: string, install?: string, build?: string, test?: string, run?: string }[]
  tracks: Track[]
  excluded: { path: string, reason: "secret" | "ignored" | "binary" | "too-large" }[]
}

Track {
  id: "frontend" | "backend" | "database" | "deployment" | "full"
  label: string
  units: string[]                       // unit IDs owned by this track
  loc: number
  contracts: Contract[]                 // what other tracks rely on
  providedBy: "original" | "mock" | "learner"   // when NOT the active track
}

Contract =
  | { kind: "http", method: string, path: string, requestShape?: string, responseShape?: string }
  | { kind: "db-table", name: string, columns: string[] }
  | { kind: "env", name: string }
```

`shared` and `setup` units are not tracks: they are listed per path (see below).

### paths/<pathId>.json (TS)

A path = one track at one size. A workspace can have several (e.g. backend-standard, then frontend-overview).

```ts
LearningPath {
  schemaVersion: 1
  id: string                            // "backend-standard"
  trackId: Track["id"]
  size: "overview" | "standard" | "deep"
  setupAsStep: boolean                  // design 02, D1
  sharedUnits: { unit: string, mode: "provided" | "taught" }[]
  generatedWith: { planning: ModelRef, at: string }
  status: "preparing" | "ready" | "partial"   // partial = some steps still being prepared
  milestones: Milestone[]
  steps: Step[]
}

Milestone { id: string, title: string, summary: string, stepIds: string[] }

Step {
  id: string                            // "s07"
  index: number
  title: string
  goal: string                          // one or two sentences, shown before the lesson loads
  concepts: string[]                    // "dependency injection", "JWT", …
  introduces: UnitChange[]
  dependsOn: string[]                   // step IDs
  checkIds: string[]
  estimatedMinutes: number
  prep: "planned" | "reference-ready" | "checks-ready" | "ready"
  checkStrength: "strong" | "weak"      // weak = build-only or AI-judged (design 02 ⑧)
  reference: { commit: string }         // commit in cache/…/reference.git for R_k
}

UnitChange {
  unit: string                          // "src/users/users.service.ts#UsersService.create"
  kind: "file" | "function" | "class" | "method" | "component" | "route" | "config" | "other"
  change: "add" | "extend"              // extend = unit already exists, grows in this step
}
```

### checks/<pathId>/<checkId>.json (TS writes, Rust runs)

```ts
Check {
  schemaVersion: 1
  id: string                            // "chk-s07-2"
  stepId: string
  label: string                         // shown to the learner: "POST /users returns 201"
  origin: "repo" | "generated"
  timeoutMs: number
  spec: CheckSpec
  validation: { failsOnPrevious: boolean, passesOnReference: boolean, at: string }   // red → green
}

CheckSpec =
  | { kind: "test",    root: string, runner: "jest" | "vitest" | "pytest" | "go" | "dotnet" | "other",
                       command: string, filter: string[], files: string[] }   // files = generated test files
  | { kind: "http",    server: Server, requests: HttpExpectation[] }
  | { kind: "command", command: string, stdin?: string,
                       expect: { exitCode?: number, stdoutIncludes?: string[], stdoutRegex?: string } }
  | { kind: "build",   root: string, command: string }
  | { kind: "docker",  context: string, dockerfile: string, run?: { port: number, healthPath: string } }

Server { start: string, root: string, port: number, readyPath: string, env?: Record<string, string> }

HttpExpectation {
  method: string, path: string, headers?: Record<string, string>, body?: unknown,
  expect: { status: number, jsonSubset?: unknown, bodyIncludes?: string[] }
}
```

Generated test files live in `.knyc/checks/…/files/` and are copied into the workspace only while a
check runs, so the learner can't accidentally edit or delete them.

### Check run result (Rust)

```ts
CheckRun {
  checkId: string
  at: string
  status: "pass" | "fail" | "error" | "timeout"
  durationMs: number
  output: string                        // stdout + stderr, truncated to 64 KB
  failures: { message: string, expected?: string, actual?: string, file?: string, line?: number }[]
}
```

Appended to `runs/<pathId>/<stepId>.jsonl` (one JSON per line).

### lessons/<pathId>/<stepId>.json (TS)

```ts
Lesson {
  schemaVersion: 1
  stepId: string
  generatedWith: ModelRef
  at: string
  explanation: string                   // Markdown
  architectureNote?: string             // where this fits in the big picture
  hints: { level: 1 | 2 | 3, text: string, unlockedAt?: string }[]
  chat: { role: "user" | "assistant", content: string, at: string }[]   // step Q&A
}
```

### progress.json (TS)

```ts
Progress {
  schemaVersion: 1
  activePathId?: string
  paths: Record<string, PathProgress>
  tracksDone: { trackId: Track["id"], pathId: string, snapshot: string }[]   // learner code replaces original
}

PathProgress {
  currentStepId: string
  startedAt: string
  completedAt?: string
  steps: Record<string, StepProgress>
}

StepProgress {
  status: "locked" | "available" | "in-progress" | "passed" | "skipped"
  startedAt?: string
  passedAt?: string
  attempts: number                      // check runs
  hintsUsed: (1 | 2 | 3)[]
  revealed: boolean
  timeSpentSec: number
  snapshot?: string                     // commit in snapshots.git when passed
}
```

Stats shown to the learner (hints used, reveals, time) come from here.

---

## Decisions

- **E1 — History storage**: git commits via libgit2 for both the reference timeline and learner
  snapshots. "Reveal original" = `git diff <pathId>/s(k-1) <pathId>/sk`.
- **E2 — Reference timeline location**: app cache. If the cache is deleted or the workspace moves to
  another machine, the timeline is regenerated from the source (cached summaries make it cheaper).
