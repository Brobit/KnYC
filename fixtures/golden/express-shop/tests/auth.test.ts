import request from "supertest";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { TokenService } from "../src/auth/tokens.js";
import { auth, registerUser, testApp } from "./helpers.js";

describe("password hashing", () => {
  it("verifies the right password only", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored).toContain(":");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
    expect(await verifyPassword("x", "malformed")).toBe(false);
  });
});

describe("TokenService", () => {
  it("round-trips a payload and rejects tampered tokens", () => {
    const tokens = new TokenService("s3cret", 60);
    const token = tokens.sign({ sub: "u1", role: "customer" });
    expect(tokens.verify(token)).toEqual({ sub: "u1", role: "customer" });
    expect(tokens.verify(token + "x")).toBeNull();
    expect(new TokenService("other", 60).verify(token)).toBeNull();
  });
});

describe("/auth and /me", () => {
  it("registers the first user as admin and the next as customer", async () => {
    const { app } = testApp();
    const first = await registerUser(app, "a@test.dev");
    const second = await registerUser(app, "b@test.dev");
    expect(first.user.role).toBe("admin");
    expect(second.user.role).toBe("customer");
    expect(first.user).not.toHaveProperty("passwordHash");
  });

  it("rejects duplicate emails and short passwords", async () => {
    const { app } = testApp();
    await registerUser(app, "a@test.dev");
    const dup = await request(app).post("/auth/register").send({ email: "A@test.dev", name: "A", password: "password123" });
    expect(dup.status).toBe(409);
    const short = await request(app).post("/auth/register").send({ email: "c@test.dev", name: "C", password: "short" });
    expect(short.status).toBe(400);
  });

  it("logs in and returns the profile", async () => {
    const { app } = testApp();
    await registerUser(app, "a@test.dev");
    const login = await request(app).post("/auth/login").send({ email: "a@test.dev", password: "password123" });
    expect(login.status).toBe(200);
    const me = await request(app).get("/me").set(auth(login.body.token));
    expect(me.body.email).toBe("a@test.dev");
  });

  it("rejects wrong passwords and missing tokens", async () => {
    const { app } = testApp();
    await registerUser(app, "a@test.dev");
    expect((await request(app).post("/auth/login").send({ email: "a@test.dev", password: "nope" })).status).toBe(401);
    expect((await request(app).get("/me")).status).toBe(401);
    expect((await request(app).get("/me").set(auth("garbage"))).status).toBe(401);
  });
});
