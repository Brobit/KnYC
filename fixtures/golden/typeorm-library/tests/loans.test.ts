import type { DataSource } from "typeorm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addBook } from "../src/queries/catalog.js";
import { addMember, findMember } from "../src/queries/members.js";
import { availableBooks, borrowBook, BookUnavailableError, overdueLoans, returnBook } from "../src/queries/loans.js";
import { freshDb } from "./db.js";

let ds: DataSource;
beforeEach(async () => {
  ds = await freshDb();
});
afterEach(() => ds.destroy());

describe("members", () => {
  it("stores emails in lower case and finds them in any case", async () => {
    await addMember(ds, { email: "Ada@Example.com", name: "Ada" });
    expect((await findMember(ds, "ADA@example.com"))?.name).toBe("Ada");
  });
});

describe("loans", () => {
  it("lends a book once until it is returned", async () => {
    const book = await addBook(ds, { title: "Kindred", year: 1979, author: "Butler" });
    const ada = await addMember(ds, { email: "ada@example.com", name: "Ada" });
    const loan = await borrowBook(ds, { bookId: book.id, memberId: ada.id, days: 7, now: new Date("2026-01-01") });
    expect(loan.dueAt.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    await expect(borrowBook(ds, { bookId: book.id, memberId: ada.id })).rejects.toBeInstanceOf(BookUnavailableError);
    expect(await availableBooks(ds)).toEqual([]);

    const back = await returnBook(ds, loan.id, new Date("2026-01-05"));
    expect(back.returnedAt?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect((await returnBook(ds, loan.id, new Date("2026-02-01"))).returnedAt?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect((await availableBooks(ds)).map((b) => b.title)).toEqual(["Kindred"]);
  });

  it("lists open loans past due, oldest first", async () => {
    const ada = await addMember(ds, { email: "ada@example.com", name: "Ada" });
    const a = await addBook(ds, { title: "A", year: 2000, author: "X" });
    const b = await addBook(ds, { title: "B", year: 2001, author: "X" });
    const c = await addBook(ds, { title: "C", year: 2002, author: "X" });
    await borrowBook(ds, { bookId: a.id, memberId: ada.id, days: 10, now: new Date("2026-01-01") });
    await borrowBook(ds, { bookId: b.id, memberId: ada.id, days: 3, now: new Date("2026-01-01") });
    const returned = await borrowBook(ds, { bookId: c.id, memberId: ada.id, days: 1, now: new Date("2026-01-01") });
    await returnBook(ds, returned.id);
    const overdue = await overdueLoans(ds, new Date("2026-01-20"));
    expect(overdue.map((l) => [l.book.title, l.member.name])).toEqual([
      ["B", "Ada"],
      ["A", "Ada"],
    ]);
  });
});
