# prisma-library

A small lending library on SQLite with Prisma 7, behind an Express 5 API. KnYC golden fixture for
the database track (#98).

- `prisma/schema.prisma`: authors, books, members and loans (one open loan per book).
- `prisma/migrations/`: `init` (authors and books), then `loans` (members and loans).
- `prisma/seed.ts`: sample data.
- `src/db.ts`: the client (better-sqlite3 adapter); `src/queries/`: the queries, each taking the
  client.
- `src/app.ts`, `src/server.ts`: the API (the backend track).

```bash
npm ci
npm run build        # prisma generate && tsc
npm test             # each test migrates its own SQLite file
npm run db:migrate   # dev.db, then npm run db:seed and npm start
```
