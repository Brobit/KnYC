import { randomUUID } from "node:crypto";

export type IdGenerator = () => string;

export const uuid: IdGenerator = () => randomUUID();

// Deterministic ids for tests: "user-1", "user-2", …
export function sequentialIds(prefix: string): IdGenerator {
  let next = 1;
  return () => `${prefix}-${next++}`;
}
