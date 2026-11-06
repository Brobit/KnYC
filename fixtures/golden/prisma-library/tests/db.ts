import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../src/db.js";

/** A client on a fresh SQLite file with every migration applied. */
export function freshDb(): Db {
  const url = `file:${join(mkdtempSync(join(tmpdir(), "library-")), "test.db")}`;
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  return createDb(url);
}
