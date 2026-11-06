# typeorm-library

A small lending library on SQLite with TypeORM 1.x, behind an Express 5 API. KnYC golden fixture
for the database track (#99); the same library as `prisma-library` and `drizzle-library`.

- `src/entities/`: authors, books, members and loans (decorators, relations both ways).
- `src/db/migrations/`: `init` (authors and books), then `loans` (members and loans), as SQL.
- `src/db/data-source.ts`: the data source (better-sqlite3) listing entities and migrations;
  `migrate.ts` and `seed.ts` are scripts.
- `src/queries/`: the queries, each taking the data source.
- `src/app.ts`, `src/server.ts`: the API (the backend track).

```bash
npm ci
npm run build
npm test             # each test migrates its own SQLite file
npm run db:migrate   # dev.db, then npm run db:seed and npm start
```
