import express from "express";
import type { DataSource } from "typeorm";
import { addBook, booksByAuthor, searchBooks } from "./queries/catalog.js";
import { addMember } from "./queries/members.js";
import { availableBooks, borrowBook, BookUnavailableError, overdueLoans, returnBook } from "./queries/loans.js";

export function createApp(ds: DataSource) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/books", async (req, res) => {
    const { author, q } = req.query;
    if (typeof author === "string") res.json(await booksByAuthor(ds, author));
    else res.json(await searchBooks(ds, typeof q === "string" ? q : ""));
  });

  app.get("/books/available", async (_req, res) => {
    res.json(await availableBooks(ds));
  });

  app.post("/books", async (req, res) => {
    const { title, year, author } = req.body ?? {};
    if (typeof title !== "string" || typeof author !== "string" || !Number.isInteger(year)) {
      res.status(400).json({ error: "title, year and author are required" });
      return;
    }
    res.status(201).json(await addBook(ds, { title, year, author }));
  });

  app.post("/members", async (req, res) => {
    const { email, name } = req.body ?? {};
    if (typeof email !== "string" || typeof name !== "string") {
      res.status(400).json({ error: "email and name are required" });
      return;
    }
    res.status(201).json(await addMember(ds, { email, name }));
  });

  app.post("/loans", async (req, res) => {
    const { bookId, memberId, days } = req.body ?? {};
    try {
      res.status(201).json(await borrowBook(ds, { bookId, memberId, days }));
    } catch (error) {
      if (error instanceof BookUnavailableError) res.status(409).json({ error: error.message });
      else throw error;
    }
  });

  app.post("/loans/:id/return", async (req, res) => {
    res.json(await returnBook(ds, Number(req.params.id)));
  });

  app.get("/loans/overdue", async (_req, res) => {
    res.json(await overdueLoans(ds));
  });

  return app;
}
