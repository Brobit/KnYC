import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = PrismaClient;

/** A client for the SQLite file at `url` ("file:./dev.db"); every query module takes one. */
export function createDb(url = process.env.DATABASE_URL ?? "file:./dev.db"): Db {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}
