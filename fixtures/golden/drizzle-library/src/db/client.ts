import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

/** A client on the SQLite file `file`; every query module takes one. */
export function createDb(file = process.env.DATABASE_FILE ?? "dev.db") {
  return drizzle(new Database(file), { schema });
}

export type Db = ReturnType<typeof createDb>;
