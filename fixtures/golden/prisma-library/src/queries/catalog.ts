import type { Db } from "../db.js";

/** Adds a book, creating its author on first use (author names are unique). */
export function addBook(db: Db, input: { title: string; year: number; author: string }) {
  return db.book.create({
    data: {
      title: input.title,
      year: input.year,
      author: { connectOrCreate: { where: { name: input.author }, create: { name: input.author } } },
    },
    include: { author: true },
  });
}

/** An author's books, oldest first; empty when the author is unknown. */
export function booksByAuthor(db: Db, author: string) {
  return db.book.findMany({ where: { author: { name: author } }, orderBy: { year: "asc" } });
}

/** Books whose title contains `text`, by title. */
export function searchBooks(db: Db, text: string) {
  return db.book.findMany({ where: { title: { contains: text } }, orderBy: { title: "asc" }, include: { author: true } });
}

/** Authors with how many books each has, most first. */
export async function authorShelf(db: Db) {
  const authors = await db.author.findMany({ include: { _count: { select: { books: true } } } });
  return authors.map((a) => ({ name: a.name, books: a._count.books })).sort((a, b) => b.books - a.books || a.name.localeCompare(b.name));
}
