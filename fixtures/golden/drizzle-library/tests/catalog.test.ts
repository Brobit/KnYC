import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { addBook, authorShelf, booksByAuthor, searchBooks } from "../src/queries/catalog.js";
import { authors } from "../src/db/schema.js";
import { freshDb } from "./db.js";

let db: Db;
beforeEach(() => {
  db = freshDb();
});
afterEach(() => db.$client.close());

describe("catalog", () => {
  it("creates an author once and lists their books oldest first", async () => {
    await addBook(db, { title: "The Dispossessed", year: 1974, author: "Le Guin" });
    await addBook(db, { title: "A Wizard of Earthsea", year: 1968, author: "Le Guin" });
    expect(await db.$count(authors)).toBe(1);
    expect((await booksByAuthor(db, "Le Guin")).map((b) => b.year)).toEqual([1968, 1974]);
    expect(await booksByAuthor(db, "Nobody")).toEqual([]);
  });

  it("searches titles and counts books per author", async () => {
    await addBook(db, { title: "Kindred", year: 1979, author: "Butler" });
    await addBook(db, { title: "Dawn", year: 1987, author: "Butler" });
    await addBook(db, { title: "The Dispossessed", year: 1974, author: "Le Guin" });
    expect((await searchBooks(db, "Dis")).map((b) => b.author.name)).toEqual(["Le Guin"]);
    expect(await authorShelf(db)).toEqual([
      { name: "Butler", books: 2 },
      { name: "Le Guin", books: 1 },
    ]);
  });
});
