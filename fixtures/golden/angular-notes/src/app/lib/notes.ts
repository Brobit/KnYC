import type { Note } from "../types";

/** Notes whose title contains the query (any case), pinned first, then the newest. */
export function visibleNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase();
  return notes
    .filter((n) => n.title.toLowerCase().includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

export const countLabel = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;
