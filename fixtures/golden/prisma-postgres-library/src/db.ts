import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = PrismaClient;

/** A client for the Postgres database at `url`; every query module takes one. */
export function createDb(url = process.env.DATABASE_URL ?? "postgresql://library:library@localhost:5432/library"): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
