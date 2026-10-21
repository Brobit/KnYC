import { describe, expect, it } from "vitest";
import { NotesStore } from "../src/notes/notes.store.js";

const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");

describe("NotesStore", () => {
  it("creates notes with incrementing ids and timestamps", () => {
    const store = new NotesStore(fixedNow);
    const a = store.create({ title: "A", body: "", tags: [] });
    const b = store.create({ title: "B", body: "", tags: [] });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(a.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("filters by tag", () => {
    const store = new NotesStore(fixedNow);
    store.create({ title: "A", body: "", tags: ["work"] });
    store.create({ title: "B", body: "", tags: ["home"] });
    expect(store.list("work").map((n) => n.title)).toEqual(["A"]);
    expect(store.list()).toHaveLength(2);
  });

  it("updates and removes notes", () => {
    const store = new NotesStore(fixedNow);
    const note = store.create({ title: "A", body: "", tags: [] });
    expect(store.update(note.id, { title: "A2" })?.title).toBe("A2");
    expect(store.update(99, { title: "x" })).toBeUndefined();
    expect(store.remove(note.id)).toBe(true);
    expect(store.remove(note.id)).toBe(false);
  });
});
