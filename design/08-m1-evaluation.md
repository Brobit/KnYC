# 08 — M1 evaluation and go / no-go

Status: **decided — GO** (2026-10-22). Closes the M1 core spike ([design 06](06-roadmap.md)).

## The question

M1 had to answer one question before any UI work: **can an AI turn a real project into steps whose
checks are proven red → green on the original code?** The bar set in design 06:

> On the golden repos, ≥ 80 % of steps have validated (strong) checks and every R_k builds.
> If not: adjust the approach before going further.

## How it was measured

`knyc eval` ran the complete pipeline — scan, graph, summaries, plan, reference timeline, checks —
on the three golden repos with the same final code (2026-10-21/22), through the Claude Code CLI:
haiku for summaries, sonnet for the plan and the generated checks, size *standard*.

A step counts as **proven** only if at least one of its checks is proven red → green **and tests
behavior**: the project's own tests, or a generated check that calls the code and asserts on the
result. Checks that only import a module or test that something exists are counted apart
(`auditCheck`), because they pass red → green without proving anything.

Raw data: [`m1-evaluation/results.json`](m1-evaluation/results.json) and the three generated
reports ([notes](m1-evaluation/express-notes.report.md),
[no-tests](m1-evaluation/express-no-tests.report.md), [shop](m1-evaluation/express-shop.report.md)).

## Results

| Project | Steps | Proven (behavior) | Weak | Merged | Timeline builds | Last step = original | Checks repo / generated | AI calls | Time |
|---|---|---|---|---|---|---|---|---|---|
| express-notes | 13 | 9 (69 %) | 3 | 1 | 12/13 | yes | 12 / 12 | 8* | 6 min* |
| express-no-tests | 13 | 10 (77 %) | 2 | 1 | 12/13 | yes | 0 / 23 | 18 | 12 min |
| express-shop | 20 | **20 (100 %)** | 0 | 0 | 20/20 | yes | 16 / 46 | 28 | 22 min |
| **Total** | **46** | **39 (85 %)** | 5 | 2 | 44/46 | 3/3 | 28 / 81 | 54 | 40 min |

\* express-notes reused the summaries and the plan cached by an earlier run of the same code.

Also measured:

- **0 trivial checks** out of 81 generated (the prompt rule added in #14 holds; the earlier runs
  had 3 out of 78).
- **0 retries** on generated checks in this run; plans valid on the first attempt in every run
  (5 plans in total during M1).
- **Every reference timeline ends with the original code**, byte for byte.
- Tokens and the CLI's cost estimate: notes 88k in / 10k out (≈ $0.22, partly cached),
  no-tests 212k / 36k (≈ $0.58), shop 336k / 67k (≈ $1.16). On a subscription these count against
  the plan's usage limits — one limit was hit during M1, on a day of heavy testing.

## Why the 7 other steps aren't proven

| Cause | Steps | Avoidable? |
|---|---|---|
| **Step 1 can't build alone**: `config.ts` uses `process`, and since TypeScript 6 Node's types only arrive through Express's types | notes s01, no-tests s01 | The merge into s02 works as designed; a setup fix could keep step 1 |
| **Types only** (interfaces erased at compile time): nothing to run | notes s04, no-tests s03 | No — the model is right to decline them |
| **A private helper alone in a step** (`isStringArray`, `parseId`, `parseUrl` are not exported, so no check can call them) | notes s08, s10, no-tests s06 | **Yes — a planning flaw** |

The last two causes are the same problem: **the planner makes steps out of units with no visible
effect**. A step whose units are only types or non-exported helpers can't be checked — and isn't a
satisfying step for a learner either ("write a type guard" with nothing to see working).

## Decision: GO

- **85 % of steps are proven** (bar: 80 %), on behavior checks only, with the same code for all
  three projects.
- **Every remaining R_k builds** and the last one is the original code; the two steps that couldn't
  build alone were merged automatically, as design 02 ⑦ specifies.
- The approach works at both ends: a project with **no tests at all** reaches 77 % with generated
  checks only, and the medium project reaches **100 %**, mostly through generated checks (its own
  16 tests all turn green at a single step, because they go through `createApp`).

Two projects are individually under 80 %. Both are explained by the planning flaw above, not by
check generation, which is why the decision is GO with the first fix below done before M3 (it
doesn't block M2, the editor shell).

## What M1 taught us (decisions carried forward)

1. **Keep the deterministic core.** Units, step order, dependencies, slicing and the red → green
   proof are code, not AI. The AI only groups, names and writes tests — and every answer is checked.
   This is why plans were valid on the first attempt and failures were always explainable.
2. **Give the model what exists, not what changed.** Checks went from 67 % to 87 % on no-tests once
   the prompt listed the real exports at each step (the model was inventing names of earlier code).
3. **Send back the real error.** Node prints the cause first and a long summary after; the tail
   alone made retries blind.
4. **Count only what proves something.** "Red → green" is necessary, not sufficient: import-only
   checks pass it too.
5. **Both check sources are needed.** Real test suites often only go green late (integration tests
   through the app); generated checks cover the steps in between.

## Improvements before / during the next milestones

| # | Improvement | Why | When |
|---|---|---|---|
| 1 | **Planner rule: every step introduces at least one exported unit with runtime behavior**; types and private helpers travel with the code that uses them | Fixes 5 of the 7 unproven steps; better steps for learners | Before M3 (learning loop) |
| 2 | Setup fix for implicit global types (e.g. add `"types": ["node"]` to the provided tsconfig when `@types/node` is installed) | Keeps step 1 instead of merging it | M3 |
| 3 | **Speed**: run steps in parallel (one worktree per step), group checks of several steps per AI call, faster model where good enough | 22 min for express-shop; most of it is sequential checks | M3 / M6 |
| 4 | Show progressive results: start step 1 while later steps are prepared | Waiting 10–20 min before learning is too long | M3 |
| 5 | Summaries with sonnet, or a second pass, for small inaccuracies (PUT vs PATCH, "full-stack") | Lessons will reuse summaries | M3 |
| 6 | Usage awareness: estimate usage against the plan's limits, resume after a limit | One limit hit during M1 | M3 |
| 7 | More stacks: frameworks beyond Express, frontend tracks | M1 was Express + TypeScript only | M4–M5 |
