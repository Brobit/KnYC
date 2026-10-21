import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp(loadConfig({}));
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("/notes", () => {
  it("creates, reads, lists, updates and deletes a note", async () => {
    const created = await request(app).post("/notes").send({ title: "Groceries", body: "milk", tags: ["Home"] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, title: "Groceries", tags: ["home"] });

    const read = await request(app).get("/notes/1");
    expect(read.body.title).toBe("Groceries");

    const listed = await request(app).get("/notes?tag=home");
    expect(listed.body).toHaveLength(1);

    const patched = await request(app).patch("/notes/1").send({ body: "milk, eggs" });
    expect(patched.body.body).toBe("milk, eggs");

    expect((await request(app).delete("/notes/1")).status).toBe(204);
    expect((await request(app).get("/notes/1")).status).toBe(404);
  });

  it("returns 400 with details for invalid input", async () => {
    const res = await request(app).post("/notes").send({ body: "no title" });
    expect(res.status).toBe(400);
    expect(res.body.details).toContain("title is required");
  });

  it("returns 400 for a non-numeric id", async () => {
    expect((await request(app).get("/notes/abc")).status).toBe(400);
  });

  it("returns 404 for unknown routes", async () => {
    expect((await request(app).get("/nope")).status).toBe(404);
  });
});
