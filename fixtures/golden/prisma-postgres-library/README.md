# prisma-postgres-library

prisma-library on Postgres: a small lending library with Prisma 7, behind an Express 5 API. KnYC
golden fixture for the database track on Postgres (#116): its checks run against a Postgres
container.

- `prisma/schema.prisma`: authors, books, members and loans (one open loan per book), on
  `provider = "postgresql"`.
- `prisma/migrations/`: `init` (authors and books), then `loans` (members and loans).
- `prisma/seed.ts`: sample data.
- `src/db.ts`: the client (pg adapter); `src/queries/`: the queries, each taking the client. The
  title search is case-insensitive (`mode: "insensitive"`, an `ILIKE` on Postgres).
- `src/app.ts`, `src/server.ts`: the API (the backend track).

Needs a Postgres server at `DATABASE_URL` (default
`postgresql://library:library@localhost:5432/library`):

```bash
docker run -d --rm -p 5432:5432 -e POSTGRES_USER=library -e POSTGRES_PASSWORD=library -e POSTGRES_DB=library postgres:16-alpine
npm ci
npm run build        # prisma generate && tsc
npm test             # each test migrates a new database on that server
npm run db:migrate   # then npm run db:seed and npm start
```
