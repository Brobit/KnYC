import type { DataSource } from "typeorm";
import { Member } from "../entities/member.js";

export function addMember(ds: DataSource, input: { email: string; name: string }) {
  return ds.getRepository(Member).save({ email: input.email.toLowerCase(), name: input.name });
}

export function findMember(ds: DataSource, email: string) {
  return ds.getRepository(Member).findOneBy({ email: email.toLowerCase() });
}
