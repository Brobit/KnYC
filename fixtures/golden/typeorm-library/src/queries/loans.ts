import { IsNull, LessThan, type DataSource } from "typeorm";
import { Book } from "../entities/book.js";
import { Loan } from "../entities/loan.js";

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
export function borrowBook(ds: DataSource, input: { bookId: number; memberId: number; days?: number; now?: Date }) {
  const now = input.now ?? new Date();
  return ds.transaction(async (tx) => {
    const loans = tx.getRepository(Loan);
    const open = await loans.findOneBy({ book: { id: input.bookId }, returnedAt: IsNull() });
    if (open) throw new BookUnavailableError(input.bookId);
    return loans.save({
      book: { id: input.bookId },
      member: { id: input.memberId },
      borrowedAt: now,
      dueAt: new Date(now.getTime() + (input.days ?? 14) * DAY_MS),
      returnedAt: null,
    });
  });
}

/** Closes a loan; returning it twice keeps the first return date. */
export async function returnBook(ds: DataSource, loanId: number, now = new Date()) {
  const loans = ds.getRepository(Loan);
  const loan = await loans.findOneByOrFail({ id: loanId });
  if (loan.returnedAt) return loan;
  loan.returnedAt = now;
  return loans.save(loan);
}

/** Open loans past their due date, oldest due first, with the book and the member. */
export function overdueLoans(ds: DataSource, now = new Date()) {
  return ds.getRepository(Loan).find({
    where: { returnedAt: IsNull(), dueAt: LessThan(now) },
    order: { dueAt: "ASC" },
    relations: { book: true, member: true },
  });
}

/** Books with no open loan, by title. */
export function availableBooks(ds: DataSource) {
  return ds
    .getRepository(Book)
    .createQueryBuilder("book")
    .where((qb) => {
      const open = qb.subQuery().select("1").from(Loan, "loan").where("loan.bookId = book.id").andWhere("loan.returnedAt IS NULL").getQuery();
      return `NOT EXISTS ${open}`;
    })
    .orderBy("book.title", "ASC")
    .getMany();
}
