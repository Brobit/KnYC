import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, type Db } from "../src/db/client.js";

/** A client on a fresh SQLite file with every migration applied. */
export function freshDb(): Db {
  const db = createDb(join(mkdtempSync(join(tmpdir(), "library-")), "test.db"));
  migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
