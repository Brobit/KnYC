import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A writer; their name is unique, so adding a book can find or create them by name. */
export const authors = sqliteTable("authors", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull().unique(),
});

export const books = sqliteTable(
  "books",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    title: text().notNull(),
    year: integer().notNull(),
    authorId: integer("author_id")
      .notNull()
      .references(() => authors.id),
  },
  (t) => [index("books_author_idx").on(t.authorId)],
);

export const members = sqliteTable("members", {
  id: integer().primaryKey({ autoIncrement: true }),
  email: text().notNull().unique(),
  name: text().notNull(),
  joinedAt: integer("joined_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** A book lent to a member. Open while returnedAt is null; a book has at most one open loan. */
export const loans = sqliteTable(
  "loans",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    borrowedAt: integer("borrowed_at", { mode: "timestamp_ms" }).notNull(),
    dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
    returnedAt: integer("returned_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("loans_book_idx").on(t.bookId), index("loans_member_idx").on(t.memberId)],
);

export const authorsRelations = relations(authors, ({ many }) => ({ books: many(books) }));

export const booksRelations = relations(books, ({ one, many }) => ({
  author: one(authors, { fields: [books.authorId], references: [authors.id] }),
  loans: many(loans),
}));

export const membersRelations = relations(members, ({ many }) => ({ loans: many(loans) }));

export const loansRelations = relations(loans, ({ one }) => ({
  book: one(books, { fields: [loans.bookId], references: [books.id] }),
  member: one(members, { fields: [loans.memberId], references: [members.id] }),
}));
