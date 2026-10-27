import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("the notes API", () => {
  it("creates, lists, pins and deletes notes", async () => {
    const app = createApp();
    const created = await request(app).post("/api/notes").send({ title: "  Buy milk " }).expect(201);
    expect(created.body).toMatchObject({ id: 1, title: "Buy milk", pinned: false });
    await request(app).patch("/api/notes/1").send({ pinned: true }).expect(200);
    const list = await request(app).get("/api/notes").expect(200);
    expect(list.body).toEqual([expect.objectContaining({ id: 1, pinned: true })]);
    await request(app).delete("/api/notes/1").expect(204);
    await request(app).delete("/api/notes/1").expect(404);
  });

  it("refuses an empty title and a bad pinned value", async () => {
    const app = createApp();
    await request(app).post("/api/notes").send({ title: " " }).expect(400);
    await request(app).post("/api/notes").send({ title: "x" }).expect(201);
    await request(app).patch("/api/notes/1").send({ pinned: "yes" }).expect(400);
  });

  it("answers /api/health", async () => {
    await request(createApp()).get("/api/health").expect(200, { status: "ok" });
  });
});
