import request from "supertest";
import type { DataSource } from "typeorm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { freshDb } from "./db.js";

let ds: DataSource;
beforeEach(async () => {
  ds = await freshDb();
});
afterEach(() => ds.destroy());

describe("API", () => {
  it("adds books and lists them by author", async () => {
    const app = createApp(ds);
    await request(app).post("/books").send({ title: "Kindred", year: 1979, author: "Butler" }).expect(201);
    await request(app).post("/books").send({ title: "Kindred" }).expect(400);
    const res = await request(app).get("/books").query({ author: "Butler" }).expect(200);
    expect(res.body.map((b: { title: string }) => b.title)).toEqual(["Kindred"]);
  });

  it("answers 409 when the book is already on loan", async () => {
    const app = createApp(ds);
    const book = (await request(app).post("/books").send({ title: "Dawn", year: 1987, author: "Butler" })).body;
    const member = (await request(app).post("/members").send({ email: "ada@example.com", name: "Ada" })).body;
    await request(app).post("/loans").send({ bookId: book.id, memberId: member.id }).expect(201);
    await request(app).post("/loans").send({ bookId: book.id, memberId: member.id }).expect(409);
  });
});
