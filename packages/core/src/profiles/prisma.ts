// Prisma (#98, VISION §3 Database; golden repo prisma-library on SQLite). An ORM next to a web
// framework, not instead of it: its rules place the database track's files (the schema, the
// migrations, the seed, the client and the queries), the web framework's place the rest.

import type { Profile } from "./types.ts";

export const prisma: Profile = {
  id: "prisma",
  label: "Prisma",
  kind: "database",
  trackRules: [
    { glob: "prisma.config.*", track: "setup" },
    { glob: "**/prisma/**", track: "database" },
    { glob: "**/*.sql", track: "database" },
    { glob: "**/{db,database,prisma}.{ts,js,mts,mjs}", track: "database" },
    { glob: "**/{db,database,queries,repositories,repository}/**", track: "database" },
  ],
  // Not used: a file no rule places gets the web framework's default track.
  defaultTrack: "backend",
  buildOrder: [
    "enums and the models with no foreign key",
    "the models that hold a foreign key to them",
    "the migration that creates those tables",
    "the function that creates the client",
    "simple queries on the tables that exist",
    "queries across relations, and transactions",
    "the seed",
  ],
  check: {
    hints: [
      "models and migrations: a test that applies the migrations to a fresh SQLite file, then writes and reads rows through the project's client (the tables exist and keep the data)",
      "queries: the project's own tests where they cover them, else a test on a fresh migrated SQLite file that calls the query and compares what it returns",
      "a fresh database per test: the recipe below migrates a new SQLite file (and seeds it when asked) and returns its URL; give that URL to the project's own client factory, imported statically from its compiled output",
      "the seed isn't compiled: `freshDatabase(true)` runs it, then count the rows it wrote",
      "never spawn `npx` or `npm` (they need a shell on Windows), and import project code with static imports from the given paths, not import() of an absolute path",
    ],
    fallback: "build",
    // Tested on prisma-library (Windows): the seed command runs through a shell, so the
    // package's node_modules/.bin goes first in PATH, as npm scripts do.
    recipe: `import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

function freshDatabase(seed = false) {
  const url = "file:" + join(mkdtempSync(join(tmpdir(), "knyc-db-")), "test.db");
  const env = { ...process.env, DATABASE_URL: url, PATH: resolve("node_modules/.bin") + delimiter + process.env.PATH };
  const prisma = (...args) => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], { env, stdio: "pipe" });
  prisma("migrate", "deploy");
  if (seed) prisma("db", "seed");
  return url;
}`,
  },
  lessonHints: [
    "schema.prisma describes the tables: one model per table, one field per column; `@id`, `@unique` and `@default` become constraints and defaults in the database.",
    "A relation has two sides: the model with `@relation(fields: [authorId], references: [id])` holds the foreign key column; the other side (`books Book[]`) is only a way to query it and has no column.",
    "After changing the schema, `npx prisma migrate dev --name <what changed>` writes a migration (the SQL that changes the tables), applies it to the development database and regenerates the client.",
    "Migrations are applied in order and never edited once shared: a fresh database gets every one with `npx prisma migrate deploy`.",
    "The generated client has one accessor per model (`db.book.findMany`, `db.loan.create`); `include` loads related rows, `where` filters, `orderBy` sorts.",
    "`db.$transaction(async (tx) => …)` runs several queries as one: if one throws, none is kept. Check-then-write rules (one open loan per book) belong in one.",
  ],
};
