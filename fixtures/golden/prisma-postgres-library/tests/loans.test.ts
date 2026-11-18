import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db.js";
import { addBook } from "../src/queries/catalog.js";
import { addMember, findMember } from "../src/queries/members.js";
import { availableBooks, borrowBook, BookUnavailableError, overdueLoans, returnBook } from "../src/queries/loans.js";
import { freshDb } from "./db.js";

let db: Db;
beforeEach(() => {
  db = freshDb();
});
afterEach(() => db.$disconnect());

describe("members", () => {
  it("stores emails in lower case and finds them in any case", async () => {
    await addMember(db, { email: "Ada@Example.com", name: "Ada" });
    expect((await findMember(db, "ADA@example.com"))?.name).toBe("Ada");
  });
});

describe("loans", () => {
  it("lends a book once until it is returned", async () => {
    const book = await addBook(db, { title: "Kindred", year: 1979, author: "Butler" });
    const ada = await addMember(db, { email: "ada@example.com", name: "Ada" });
    const loan = await borrowBook(db, { bookId: book.id, memberId: ada.id, days: 7, now: new Date("2026-01-01") });
    expect(loan.dueAt.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    await expect(borrowBook(db, { bookId: book.id, memberId: ada.id })).rejects.toBeInstanceOf(BookUnavailableError);
    expect(await availableBooks(db)).toEqual([]);

    const back = await returnBook(db, loan.id, new Date("2026-01-05"));
    expect(back.returnedAt?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect((await returnBook(db, loan.id, new Date("2026-02-01"))).returnedAt?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect((await availableBooks(db)).map((b) => b.title)).toEqual(["Kindred"]);
  });

  it("lists open loans past due, oldest first", async () => {
    const ada = await addMember(db, { email: "ada@example.com", name: "Ada" });
    const a = await addBook(db, { title: "A", year: 2000, author: "X" });
    const b = await addBook(db, { title: "B", year: 2001, author: "X" });
    const c = await addBook(db, { title: "C", year: 2002, author: "X" });
    await borrowBook(db, { bookId: a.id, memberId: ada.id, days: 10, now: new Date("2026-01-01") });
    await borrowBook(db, { bookId: b.id, memberId: ada.id, days: 3, now: new Date("2026-01-01") });
    const returned = await borrowBook(db, { bookId: c.id, memberId: ada.id, days: 1, now: new Date("2026-01-01") });
    await returnBook(db, returned.id);
    const overdue = await overdueLoans(db, new Date("2026-01-20"));
    expect(overdue.map((l) => [l.book.title, l.member.name])).toEqual([
      ["B", "Ada"],
      ["A", "Ada"],
    ]);
  });
});
