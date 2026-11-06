# drizzle-library

A small lending library on SQLite with Drizzle ORM, behind an Express 5 API. KnYC golden fixture
for the database track (#99); the same library as `prisma-library` and `typeorm-library`.

- `src/db/schema.ts`: the tables (authors, books, members, loans) and their relations.
- `drizzle/`: the migrations drizzle-kit generated (`init`, then `loans`), with their journal and
  snapshots in `meta/`.
- `src/db/client.ts`: the client (better-sqlite3); `migrate.ts` and `seed.ts` are scripts.
- `src/queries/`: the queries, each taking the client.
- `src/app.ts`, `src/server.ts`: the API (the backend track).

```bash
npm ci
npm run build
npm test             # each test migrates its own SQLite file
npm run db:migrate   # dev.db, then npm run db:seed and npm start
npm run db:generate  # after changing the schema: a new migration
```
