import type { Note } from "../types";

/** Notes whose title contains the query (any case), pinned first, then the newest. */
export function visibleNotes(notes: Note[], query: string): Note[] {
  const needle = query.trim().toLowerCase();
  return notes
    .filter((n) => !needle || n.title.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

/** "1 note", "3 notes". */
export const countLabel = (count: number) => `${count} ${count === 1 ? "note" : "notes"}`;
