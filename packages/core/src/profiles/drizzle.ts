// Drizzle ORM (#99; golden repo drizzle-library on SQLite). Like Prisma, an ORM next to a web
// framework: its rules place the database track (the schema, the SQL migrations drizzle-kit
// writes, the client, the queries, the seed), the web framework's place the rest.

import type { Profile } from "./types.ts";

export const drizzle: Profile = {
  id: "drizzle",
  label: "Drizzle",
  kind: "database",
  trackRules: [
    { glob: "drizzle.config.*", track: "setup" },
    { glob: "**/drizzle/**", track: "database" },
    { glob: "**/*.sql", track: "database" },
    { glob: "**/{schema,db,database}.{ts,js,mts,mjs}", track: "database" },
    { glob: "**/{db,database,schema,queries,repositories,repository}/**", track: "database" },
  ],
  // Not used: a file no rule places gets the web framework's default track.
  defaultTrack: "backend",
  buildOrder: [
    "the tables with no foreign key",
    "the tables that reference them",
    "the migration drizzle-kit generates for those tables",
    "the relations (what the relational queries can load with `with`)",
    "the function that creates the client",
    "simple queries on the tables that exist",
    "queries across tables, and transactions",
    "the seed",
  ],
  check: {
    hints: [
      "tables and migrations: a test that migrates a fresh SQLite file, then inserts and reads rows through the project's client (the tables exist and keep the data)",
      "queries: the project's own tests where they cover them, else a test on a fresh migrated SQLite file that calls the query and compares what it returns",
      "a fresh database per test: the recipe below gives a new SQLite file; create the project's client on it and migrate it with drizzle-orm's migrator, `migrationsFolder` being drizzle.config's `out` folder (\"drizzle\" by default), relative to the package root",
      "the seed is a script: run its compiled file with `process.execPath` and the environment variable the client reads for its file",
      "never spawn `npx` or `npm` (they need a shell on Windows), and import project code with static imports from the given paths",
    ],
    fallback: "build",
    // Tested on drizzle-library (Windows), with the better-sqlite3 driver.
    recipe: `import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

function freshFile() {
  return join(mkdtempSync(join(tmpdir(), "knyc-db-")), "test.db");
}
// const db = createDb(freshFile()); // the project's own client factory
// migrate(db, { migrationsFolder: "drizzle" });`,
  },
  lessonHints: [
    "A table is a variable: `sqliteTable(\"books\", { … })` names the table and its columns; `.references(() => authors.id)` makes a foreign key.",
    "`npx drizzle-kit generate --name <what changed>` compares the schema with the last snapshot and writes the SQL migration, its snapshot and an entry in meta/_journal.json.",
    "The migrator applies the migrations listed in the journal, in order, once each; a fresh database gets all of them.",
    "`relations(...)` doesn't change the database: it tells the relational query API (`db.query.books.findMany({ with: { author: true } })`) how tables connect.",
    "The SQL-like API (`db.select().from(books).where(eq(books.id, 1))`) maps one to one to SQL; with better-sqlite3 it runs synchronously (`.get()`, `.all()`).",
    "`db.transaction((tx) => …)` runs several queries as one: if one throws, none is kept.",
  ],
};
