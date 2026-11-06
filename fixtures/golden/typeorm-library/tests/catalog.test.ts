import type { DataSource } from "typeorm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Author } from "../src/entities/author.js";
import { addBook, authorShelf, booksByAuthor, searchBooks } from "../src/queries/catalog.js";
import { freshDb } from "./db.js";

let ds: DataSource;
beforeEach(async () => {
  ds = await freshDb();
});
afterEach(() => ds.destroy());

describe("catalog", () => {
  it("creates an author once and lists their books oldest first", async () => {
    await addBook(ds, { title: "The Dispossessed", year: 1974, author: "Le Guin" });
    await addBook(ds, { title: "A Wizard of Earthsea", year: 1968, author: "Le Guin" });
    expect(await ds.getRepository(Author).count()).toBe(1);
    expect((await booksByAuthor(ds, "Le Guin")).map((b) => b.year)).toEqual([1968, 1974]);
    expect(await booksByAuthor(ds, "Nobody")).toEqual([]);
  });

  it("searches titles and counts books per author", async () => {
    await addBook(ds, { title: "Kindred", year: 1979, author: "Butler" });
    await addBook(ds, { title: "Dawn", year: 1987, author: "Butler" });
    await addBook(ds, { title: "The Dispossessed", year: 1974, author: "Le Guin" });
    expect((await searchBooks(ds, "Dis")).map((b) => b.author.name)).toEqual(["Le Guin"]);
    expect(await authorShelf(ds)).toEqual([
      { name: "Butler", books: 2 },
      { name: "Le Guin", books: 1 },
    ]);
  });
});
