import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { members } from "../db/schema.js";

export function addMember(db: Db, input: { email: string; name: string }) {
  return db.insert(members).values({ email: input.email.toLowerCase(), name: input.name }).returning().get();
}

export function findMember(db: Db, email: string) {
  return db.select().from(members).where(eq(members.email, email.toLowerCase())).get();
}
