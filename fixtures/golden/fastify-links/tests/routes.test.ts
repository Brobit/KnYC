import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const admin = { authorization: "Bearer secret" };

describe("the API, through app.inject", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ port: 0, adminToken: "secret", baseUrl: "https://sho.rt" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("answers GET /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("creates a link with the admin token and shows its short URL", async () => {
    const res = await app.inject({ method: "POST", url: "/links", headers: admin, payload: { url: "https://example.com/docs", slug: "docs" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ slug: "docs", url: "https://example.com/docs", visits: 0, shortUrl: "https://sho.rt/r/docs" });
    const one = await app.inject({ method: "GET", url: "/links/docs" });
    expect(one.json().shortUrl).toBe("https://sho.rt/r/docs");
  });

  it("refuses changes without the admin token", async () => {
    expect((await app.inject({ method: "POST", url: "/links", payload: { url: "https://example.com" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/links/docs", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
  });

  it("validates bodies with the route schema, and says when a slug is taken", async () => {
    expect((await app.inject({ method: "POST", url: "/links", headers: admin, payload: { url: "ftp://example.com" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/links", headers: admin, payload: { url: "https://example.com", slug: "No Spaces" } })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/links", headers: admin, payload: { url: "https://example.com", slug: "same" } });
    expect((await app.inject({ method: "POST", url: "/links", headers: admin, payload: { url: "https://other.example", slug: "same" } })).statusCode).toBe(409);
  });

  it("redirects a short link, counts the visit, and forgets a deleted one", async () => {
    await app.inject({ method: "POST", url: "/links", headers: admin, payload: { url: "https://example.com/a", slug: "go-a" } });
    const visit = await app.inject({ method: "GET", url: "/r/go-a" });
    expect(visit.statusCode).toBe(302);
    expect(visit.headers.location).toBe("https://example.com/a");
    expect((await app.inject({ method: "GET", url: "/links" })).json()[0]).toMatchObject({ slug: "go-a", visits: 1 });
    expect((await app.inject({ method: "DELETE", url: "/links/go-a", headers: admin })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/r/go-a" })).statusCode).toBe(404);
  });
});
