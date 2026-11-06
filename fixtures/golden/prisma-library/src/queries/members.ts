import type { Db } from "../db.js";

export function addMember(db: Db, input: { email: string; name: string }) {
  return db.member.create({ data: { email: input.email.toLowerCase(), name: input.name } });
}

export function findMember(db: Db, email: string) {
  return db.member.findUnique({ where: { email: email.toLowerCase() } });
}
