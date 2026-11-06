import express from "express";
import type { Db } from "./db/client.js";
import { addBook, booksByAuthor, searchBooks } from "./queries/catalog.js";
import { addMember } from "./queries/members.js";
import { availableBooks, borrowBook, BookUnavailableError, overdueLoans, returnBook } from "./queries/loans.js";

export function createApp(db: Db) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/books", async (req, res) => {
    const { author, q } = req.query;
    if (typeof author === "string") res.json(await booksByAuthor(db, author));
    else res.json(await searchBooks(db, typeof q === "string" ? q : ""));
  });

  app.get("/books/available", async (_req, res) => {
    res.json(await availableBooks(db));
  });

  app.post("/books", async (req, res) => {
    const { title, year, author } = req.body ?? {};
    if (typeof title !== "string" || typeof author !== "string" || !Number.isInteger(year)) {
      res.status(400).json({ error: "title, year and author are required" });
      return;
    }
    res.status(201).json(await addBook(db, { title, year, author }));
  });

  app.post("/members", async (req, res) => {
    const { email, name } = req.body ?? {};
    if (typeof email !== "string" || typeof name !== "string") {
      res.status(400).json({ error: "email and name are required" });
      return;
    }
    res.status(201).json(await addMember(db, { email, name }));
  });

  app.post("/loans", async (req, res) => {
    const { bookId, memberId, days } = req.body ?? {};
    try {
      res.status(201).json(await borrowBook(db, { bookId, memberId, days }));
    } catch (error) {
      if (error instanceof BookUnavailableError) res.status(409).json({ error: error.message });
      else throw error;
    }
  });

  app.post("/loans/:id/return", async (req, res) => {
    res.json(await returnBook(db, Number(req.params.id)));
  });

  app.get("/loans/overdue", async (_req, res) => {
    res.json(await overdueLoans(db));
  });

  return app;
}
