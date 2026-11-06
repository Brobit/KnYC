import { and, asc, eq, isNull, lt, notExists } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { books, loans } from "../db/schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export class BookUnavailableError extends Error {
  readonly bookId: number;

  constructor(bookId: number) {
    super(`book ${bookId} is already on loan`);
    this.name = "BookUnavailableError";
    this.bookId = bookId;
  }
}

/** Lends a book for `days` days. A book has at most one open loan: checked and created in one transaction. */
export async function borrowBook(db: Db, input: { bookId: number; memberId: number; days?: number; now?: Date }) {
  const now = input.now ?? new Date();
  return db.transaction((tx) => {
    const open = tx
      .select()
      .from(loans)
      .where(and(eq(loans.bookId, input.bookId), isNull(loans.returnedAt)))
      .get();
    if (open) throw new BookUnavailableError(input.bookId);
    return tx
      .insert(loans)
      .values({ bookId: input.bookId, memberId: input.memberId, borrowedAt: now, dueAt: new Date(now.getTime() + (input.days ?? 14) * DAY_MS) })
      .returning()
      .get();
  });
}

/** Closes a loan; returning it twice keeps the first return date. */
export function returnBook(db: Db, loanId: number, now = new Date()) {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) throw new Error(`no loan ${loanId}`);
  if (loan.returnedAt) return loan;
  return db.update(loans).set({ returnedAt: now }).where(eq(loans.id, loanId)).returning().get();
}

/** Open loans past their due date, oldest due first, with the book and the member. */
export function overdueLoans(db: Db, now = new Date()) {
  return db.query.loans.findMany({
    where: and(isNull(loans.returnedAt), lt(loans.dueAt, now)),
    orderBy: asc(loans.dueAt),
    with: { book: true, member: true },
  });
}

/** Books with no open loan, by title. */
export function availableBooks(db: Db) {
  const open = db
    .select()
    .from(loans)
    .where(and(eq(loans.bookId, books.id), isNull(loans.returnedAt)));
  return db.select().from(books).where(notExists(open)).orderBy(asc(books.title)).all();
}
