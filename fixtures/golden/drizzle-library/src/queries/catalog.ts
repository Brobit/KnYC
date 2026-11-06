import { asc, count, eq, like } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { authors, books } from "../db/schema.js";

/** Adds a book, creating its author on first use (author names are unique). */
export function addBook(db: Db, input: { title: string; year: number; author: string }) {
  return db.transaction((tx) => {
    const author =
      tx.select().from(authors).where(eq(authors.name, input.author)).get() ?? tx.insert(authors).values({ name: input.author }).returning().get();
    return tx.insert(books).values({ title: input.title, year: input.year, authorId: author.id }).returning().get();
  });
}

/** An author's books, oldest first; empty when the author is unknown. */
export function booksByAuthor(db: Db, author: string) {
  return db
    .select({ id: books.id, title: books.title, year: books.year, authorId: books.authorId })
    .from(books)
    .innerJoin(authors, eq(books.authorId, authors.id))
    .where(eq(authors.name, author))
    .orderBy(asc(books.year))
    .all();
}

/** Books whose title contains `text`, by title, with their author. */
export function searchBooks(db: Db, text: string) {
  return db.query.books.findMany({ where: like(books.title, `%${text}%`), orderBy: asc(books.title), with: { author: true } });
}

/** Authors with how many books each has, most first. */
export function authorShelf(db: Db) {
  const rows = db.select({ name: authors.name, books: count(books.id) }).from(authors).leftJoin(books, eq(books.authorId, authors.id)).groupBy(authors.id).all();
  return rows.sort((a, b) => b.books - a.books || a.name.localeCompare(b.name));
}
