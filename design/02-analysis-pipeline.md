# 02 — Analysis pipeline

Status: **agreed** (2026-10-21) — decisions at the end.

How a folder of code becomes tracks, steps, checks and lessons.

## Core idea: the reference timeline

The hard question is *"what does the code look like at step 5?"* — the original repo only shows the
final state. KnYC answers it by building a **reference timeline**:

```
R0 ──► R1 ──► R2 ──► … ──► Rn  =  original code (for this track)
```

- Each `Rk` is a **subset of the original code**: the files, functions, classes, routes introduced
  up to step `k`. Nothing is invented — later code is just removed.
- Every `Rk` must **build**, and the checks of step `k` must **pass on `Rk` and fail on `Rk-1`**
  ("red → green"). This proves that each check really tests that step.
- The learner's job at step `k`: turn their `Rk-1` into something that passes step `k`'s checks.
- "Reveal original" for step `k` = the diff `Rk-1 → Rk`.

Steps can introduce **parts of files** (one function, one route, one component), not only whole files.
A file can grow across several steps, just like in real development.

## Pipeline overview

```
 ① Intake ─► ② Static scan ─► ③ Graph ─► ④ Track split ─► ⑤ Summaries
    (Rust)       (Rust)        (Rust)     (rules + AI)       (AI, cheap)
                                                                  │
 ⑨ Lessons ◄─ ⑧ Checks ◄─ ⑦ Reference timeline ◄─ ⑥ Curriculum plan
  (AI, lazy)   (run+AI)      (AI + validation)        (AI, strong)
```

Stages ①–③ are deterministic and free (no AI). Everything after is cached by content hash, so
re-running after a small change is cheap.

---

## ① Intake (Rust)

- Copy the source into a private **reference sandbox** (`~/.knyc/cache/<hash>/`). The source folder is
  never touched; dependencies are installed and builds run in the sandbox.
- Respect `.gitignore`; always skip `node_modules`, `dist`, `build`, `.next`, `vendor`, `bin/obj`,
  `__pycache__`, binaries, images, lockfiles (lockfiles kept as metadata only).
- **Secret guard**: never send `.env*`, keys, certificates, or lines matching secret patterns to the AI.
  Show the user the excluded files.
- Size limit for v1: warn above ~50k lines of code in the chosen track.

## ② Static scan (Rust, no AI)

Produces `project.json`:

- Languages (by extension + parser).
- Manifests: `package.json`, `tsconfig.json`, `pyproject.toml` / `requirements.txt`, `go.mod`,
  `*.csproj` / `*.sln`.
- Frameworks: each **profile** has a `detect()` rule (see VISION §6).
- Scripts & commands: npm scripts, Makefile targets, how to install / build / test / run.
- Existing tests and test runner (Jest, Vitest, pytest, `go test`, xUnit/NUnit…).
- Deployment files: `Dockerfile`, `docker-compose.yml`, `.github/workflows/*`, etc.
- Database: Prisma / TypeORM / Drizzle / SQLAlchemy / Django / EF Core migrations, SQL files.
- Required toolchains (Node, Python, Go, .NET, Docker) → checked against the user's machine.

## ③ Code graph (Rust, tree-sitter)

For each file: imports, exports, top-level symbols (functions, classes, components, routes),
lines of code. Then:

- **Dependency graph** at file and symbol level (best effort — dynamic imports, DI and reflection are
  approximated; profiles add framework knowledge, e.g. NestJS module wiring, Next.js file routing).
- **Layering**: cycles grouped together, then topological order → leaves (types, utils) first,
  entry points last. This is the backbone of the build order.

## ④ Track split (profile rules + AI)

Assign each file (or symbol) to a track: **frontend, backend, database, deployment**, plus:

- **shared**: types/utils used by several tracks → provided, or taught in the first track that needs them.
- **setup**: config files (`package.json`, `tsconfig`, linters, bundler config) → see decision D1.

Profile rules handle most files (`app/api/**` → backend in Next.js, `prisma/**` → database,
`Dockerfile` → deployment…). The AI only classifies leftovers.

Also extracted: **contracts between tracks** (HTTP endpoints, DB schema, env vars). They are used to
run a track alone: a provided original backend, or a generated mock API from the contract.

## ⑤ Summaries (AI, cheap model)

Bottom-up "map" phase: one short summary per file (role, key symbols, depends on), then per folder /
module, then one project overview. Keeps later prompts small enough for any repo size.
Cached by file hash.

## ⑥ Curriculum plan (AI, strong model)

Input: graph + layering, summaries, chosen track, path size, profile build-order hints.
Output (structured JSON, schema in design 03):

```
milestones[] → steps[]
  step: id, title, goal, concepts[], introduces (files / symbols), depends_on[],
        check_strategy, estimated_minutes
```

Path size changes the granularity, not the content:
Overview ≈ 5 steps, Standard ≈ 15, Deep dive ≈ 40.

**Deterministic validation** (no AI) of the plan:

- Every file/symbol of the track is introduced exactly once.
- A step only uses symbols from earlier steps or provided parts (checked against the graph).
- Every step has a check strategy.

Failures are sent back to the AI with the exact errors (max 3 retries).

## ⑦ Reference timeline (AI + validation)

For each step build `Rk` by **removing** not-yet-introduced code from the original:

- Whole-file additions: deterministic.
- Partial files (removing functions, routes, JSX branches, imports): AI-assisted, guided by the
  tree-sitter ranges, then verified.

Each `Rk` must build in the sandbox. If one can't be fixed in 3 tries, **merge step k with k+1** and
continue. The plan adapts instead of failing.

## ⑧ Checks (run + AI)

For each step, in order of preference (VISION §5):

1. **Existing tests**: run the repo's test suite on every `Rk`. A test that fails on `Rk-1` and passes
   on `Rk` belongs to step `k`. *Automatic mapping, no AI needed.*
2. **Generated checks**: unit tests, HTTP requests, CLI command + expected output, `docker build`…
   following the profile's check strategy.
3. **Build-only** for pure setup steps.

Every check must pass the **red → green** test. A check that doesn't is discarded or regenerated.
Steps left with only "build succeeds" are marked as weakly checked in the UI.

## ⑨ Lessons (AI, generated when the learner reaches the step)

- Explanation: what to build, why, how it fits the architecture (from summaries + diff `Rk-1 → Rk`).
- Hints in levels: 1 = nudge, 2 = approach, 3 = near-solution. Last resort: reveal the original.
- When checks fail: the AI gets the check output + learner's diff and explains what's wrong
  without giving the answer (unless the learner asks for a higher hint level).

## Starting the learner's workspace

For the chosen track, the workspace starts as: **original code of the other tracks** (provided, or
mocked) + **`R0`** of the chosen track. Tracks the learner already finished use *their* code.

## Cost, time, privacy

- Before ⑤, show an **estimate** (files to send, approximate tokens/cost for API-key users) and ask
  for confirmation.
- Cheap model for summaries, strong model for planning and timeline; configurable.
- Everything is cached; re-analysis only reprocesses changed files.
- Progress UI shows each stage live; the user can start step 1 as soon as `R1` and its checks are ready
  while later steps are still being prepared.

## Failure modes

| Problem | Fallback |
|---|---|
| Original doesn't build in the sandbox (missing env vars, DB, secrets) | Ask the user for env values / start a DB in Docker; otherwise degrade to build-only + AI-judged steps, clearly flagged |
| Toolchain missing on the user's machine | Tell the user what to install before starting |
| Repo too big | Pick a sub-folder or a single track |
| Language/framework not supported | Generic profile: graph + AI, build-only checks |
| Cyclic dependencies | Group the cycle into one step |

---

## Decisions

- **D1 — Setup files**: provided by default; a toggle at path creation makes "project setup" the
  first step for learners who want to learn the tooling.
- **D2 — Partial files**: yes. Steps can introduce parts of files (functions, routes, components);
  files grow across steps.
- **D3 — Lessons**: generated lazily when the learner reaches the step, using their actual code.
- **D4 — Cost estimate**: always shown before the AI stages, with confirmation. Can be turned off in
  settings.
