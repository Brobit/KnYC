import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "../src/db.js";

/**
 * A client on a fresh database of the Postgres server in DATABASE_URL, with every migration
 * applied: `migrate deploy` creates the database. The server keeps it (a throwaway test server).
 */
export function freshDb(): Db {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://library:library@localhost:5432/library");
  url.pathname = `/test_${randomUUID().replaceAll("-", "")}`;
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.href }, stdio: "pipe" });
  return createDb(url.href);
}
