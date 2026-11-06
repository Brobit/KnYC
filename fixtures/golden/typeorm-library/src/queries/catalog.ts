import type { DataSource } from "typeorm";
import { Author } from "../entities/author.js";
import { Book } from "../entities/book.js";

/** Adds a book, creating its author on first use (author names are unique). */
export async function addBook(ds: DataSource, input: { title: string; year: number; author: string }) {
  const authors = ds.getRepository(Author);
  const author = (await authors.findOneBy({ name: input.author })) ?? (await authors.save(authors.create({ name: input.author })));
  return ds.getRepository(Book).save({ title: input.title, year: input.year, author });
}

/** An author's books, oldest first; empty when the author is unknown. */
export function booksByAuthor(ds: DataSource, author: string) {
  return ds.getRepository(Book).find({ where: { author: { name: author } }, order: { year: "ASC" } });
}

/** Books whose title contains `text`, by title. */
export function searchBooks(ds: DataSource, text: string) {
  return ds
    .getRepository(Book)
    .createQueryBuilder("book")
    .innerJoinAndSelect("book.author", "author")
    .where("book.title LIKE :text", { text: `%${text}%` })
    .orderBy("book.title", "ASC")
    .getMany();
}

/** Authors with how many books each has, most first. */
export async function authorShelf(ds: DataSource) {
  const rows = await ds
    .getRepository(Author)
    .createQueryBuilder("author")
    .leftJoin("author.books", "book")
    .select("author.name", "name")
    .addSelect("COUNT(book.id)", "books")
    .groupBy("author.id")
    .getRawMany<{ name: string; books: number }>();
  return rows.map((r) => ({ name: r.name, books: Number(r.books) })).sort((a, b) => b.books - a.books || a.name.localeCompare(b.name));
}
