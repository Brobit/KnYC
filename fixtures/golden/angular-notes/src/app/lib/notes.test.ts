import { describe, expect, it } from "vitest";
import type { Note } from "../types";
import { countLabel, visibleNotes } from "./notes";

const note = (id: number, title: string, pinned = false): Note => ({ id, title, body: "", pinned, createdAt: `2026-10-${String(id).padStart(2, "0")}T00:00:00.000Z` });

describe("visibleNotes", () => {
  it("puts pinned notes first, then the newest", () => {
    expect(visibleNotes([note(1, "a"), note(2, "b", true), note(3, "c")], "").map((n) => n.id)).toEqual([2, 3, 1]);
  });

  it("keeps the notes whose title contains the query, in any case", () => {
    expect(visibleNotes([note(1, "Buy milk"), note(2, "Call Ann")], " MILK ").map((n) => n.title)).toEqual(["Buy milk"]);
  });

  it("counts notes", () => {
    expect([countLabel(1), countLabel(0)]).toEqual(["1 note", "0 notes"]);
  });
});
