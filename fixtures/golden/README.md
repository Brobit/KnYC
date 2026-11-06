# Golden repos

Purpose-built sample projects used as the regression suite of the KnYC pipeline (design 06, M1).
Every change to the analysis pipeline is re-run on them and measured (issue #15).

| Project | Size | Tests | What it exercises |
|---|---|---|---|
| [`express-notes`](express-notes/) | small, ~200 lines | 12 (Vitest + supertest) | Simple layering, existing-test mapping |
| [`express-shop`](express-shop/) | medium, ~850 lines, 8 modules | 16 | Auth, DI container, cross-module dependencies, business rules |
| [`nest-tasks`](nest-tasks/) | small, ~300 lines, NestJS 12 | 14 (Vitest + supertest) | Modules, DI with a token, a pipe and a guard (#96) |
| [`fastify-links`](fastify-links/) | small, ~250 lines, Fastify 5 | 10 (Vitest + app.inject) | Plugins, decorators with module augmentation, hooks, route schemas (#97) |
| [`fullstack-notes`](fullstack-notes/) | small, ~350 lines, React (Vite) + Express, 2 packages | 9 (Vitest + supertest) | The frontend track against the original API, UI checks, mount pages (#92) |
| [`prisma-library`](prisma-library/) | small, ~300 lines, Prisma 7 on SQLite + Express | 7 (Vitest, a migrated SQLite file per test) | The database track: models, migrations, queries, transactions; the API held back until its queries exist (#98) |
| [`typeorm-library`](typeorm-library/) | small, ~300 lines, TypeORM 1.x on SQLite + Express | 7 (Vitest, a migrated SQLite file per test) | The database track with entities in a relation cycle, migrations as classes (#99) |
| [`drizzle-library`](drizzle-library/) | small, ~300 lines, Drizzle on SQLite + Express | 7 (Vitest, a migrated SQLite file per test) | The database track with tables as variables, drizzle-kit migrations and their journal (#99) |
| [`express-no-tests`](express-no-tests/) | small, ~250 lines | none | Generated checks only (HTTP requests, commands) |

They are plain npm projects (not part of the pnpm workspace), like most projects users will import.
CI builds and tests them on every pull request.

```bash
cd fixtures/golden/<project>
npm ci
npm run build
npm test   # not for express-no-tests
```
