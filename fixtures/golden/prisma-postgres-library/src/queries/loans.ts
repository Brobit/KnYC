import type { Db } from "../db.js";

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
export function borrowBook(db: Db, input: { bookId: number; memberId: number; days?: number; now?: Date }) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const open = await tx.loan.findFirst({ where: { bookId: input.bookId, returnedAt: null } });
    if (open) throw new BookUnavailableError(input.bookId);
    return tx.loan.create({
      data: { bookId: input.bookId, memberId: input.memberId, borrowedAt: now, dueAt: new Date(now.getTime() + (input.days ?? 14) * DAY_MS) },
    });
  });
}

/** Closes a loan; returning it twice keeps the first return date. */
export async function returnBook(db: Db, loanId: number, now = new Date()) {
  const loan = await db.loan.findUniqueOrThrow({ where: { id: loanId } });
  if (loan.returnedAt) return loan;
  return db.loan.update({ where: { id: loanId }, data: { returnedAt: now } });
}

/** Open loans past their due date, oldest due first, with the book and the member. */
export function overdueLoans(db: Db, now = new Date()) {
  return db.loan.findMany({
    where: { returnedAt: null, dueAt: { lt: now } },
    orderBy: { dueAt: "asc" },
    include: { book: true, member: true },
  });
}

/** Books with no open loan, by title. */
export function availableBooks(db: Db) {
  return db.book.findMany({ where: { loans: { none: { returnedAt: null } } }, orderBy: { title: "asc" } });
}
