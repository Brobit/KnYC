// TypeORM (#99; golden repo typeorm-library on SQLite). Like Prisma, an ORM next to a web
// framework: its rules place the database track (entities, migrations, the data source, the
// queries, the seed), the web framework's place the rest.

import type { Profile } from "./types.ts";

export const typeorm: Profile = {
  id: "typeorm",
  label: "TypeORM",
  kind: "database",
  trackRules: [
    { glob: "{ormconfig.*,typeorm.config.*}", track: "setup" },
    { glob: "**/{entities,entity,migrations,migration}/**", track: "database" },
    { glob: "**/*.{entity,migration}.{ts,js}", track: "database" },
    { glob: "**/{data-source,datasource,db,database}.{ts,js,mts,mjs}", track: "database" },
    { glob: "**/{db,database,queries,repositories,repository}/**", track: "database" },
    { glob: "**/*.sql", track: "database" },
  ],
  // Not used: a file no rule places gets the web framework's default track.
  defaultTrack: "backend",
  buildOrder: [
    "the entities (classes that point to each other through relations come together)",
    "the migration that creates their tables",
    "the data source that lists the entities and the migrations",
    "simple queries on the tables that exist",
    "queries across relations, and transactions",
    "the seed",
  ],
  check: {
    hints: [
      "entities and migrations: a test that runs the migrations on a fresh SQLite file, then saves and reads rows through the project's data source (the tables exist and keep the data)",
      "queries: the project's own tests where they cover them, else a test on a fresh migrated SQLite file that calls the query and compares what it returns",
      "a fresh database per test: the recipe below points the project's DataSource (from its factory or the instance it exports, not initialized yet) at a new SQLite file, initializes it and runs the migrations",
      "the seed is a script: run its compiled file with `process.execPath` and the environment variable the data source reads for its file",
      "never spawn `npx` or `npm` (they need a shell on Windows), and import project code with static imports from the given paths",
    ],
    fallback: "build",
    // Tested on typeorm-library (Windows).
    recipe: `import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freshDataSource(dataSource) {
  dataSource.setOptions({ database: join(mkdtempSync(join(tmpdir(), "knyc-db-")), "test.db") });
  await dataSource.initialize();
  await dataSource.runMigrations();
  return dataSource; // await dataSource.destroy() at the end of the test
}`,
  },
  lessonHints: [
    "An entity is a class whose instances are rows: `@Entity()` maps it to a table, `@Column` fields to columns, `@PrimaryGeneratedColumn` to an auto-increment id.",
    "`@ManyToOne` holds the foreign key column; `@OneToMany` is its other side, a way to load the related rows, with no column of its own.",
    "A migration is a class with `up` (the SQL that changes the tables) and `down` (the SQL that undoes it); the data source lists them and `runMigrations()` applies the ones not applied yet.",
    "The data source is the connection: the driver, the database file, the entities and the migrations. Call `initialize()` before any query, `destroy()` when done.",
    "`dataSource.getRepository(Book)` gives find, findOneBy, save and the query builder for one entity; `relations` or a join loads related rows.",
    "`dataSource.transaction(async (tx) => …)` runs several queries as one: if one throws, none is kept.",
  ],
};
