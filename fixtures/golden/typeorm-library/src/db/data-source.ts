import "reflect-metadata";
import { DataSource } from "typeorm";
import { Author } from "../entities/author.js";
import { Book } from "../entities/book.js";
import { Loan } from "../entities/loan.js";
import { Member } from "../entities/member.js";
import { Init1767225600000 } from "./migrations/1767225600000-init.js";
import { Loans1767312000000 } from "./migrations/1767312000000-loans.js";

/** A data source on the SQLite file `file`; call `initialize()` before use. */
export function createDataSource(file = process.env.DATABASE_FILE ?? "dev.db") {
  return new DataSource({
    type: "better-sqlite3",
    database: file,
    entities: [Author, Book, Member, Loan],
    migrations: [Init1767225600000, Loans1767312000000],
  });
}
