import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { LinksStore, SlugTakenError } from "../src/links/links.store.js";
import { slugFor } from "../src/links/slug.js";
import { bearerToken } from "../src/plugins/auth.js";

describe("loadConfig", () => {
  it("has defaults and reads the environment", () => {
    expect(loadConfig({})).toEqual({ port: 3000, adminToken: "dev-token", baseUrl: "http://localhost:3000" });
    expect(loadConfig({ PORT: "4100", ADMIN_TOKEN: "t", BASE_URL: "https://sho.rt/" })).toEqual({ port: 4100, adminToken: "t", baseUrl: "https://sho.rt" });
  });
});

describe("slugFor", () => {
  it("gives short, stable slugs that grow when needed", () => {
    expect(slugFor(0)).toBe("aaa");
    expect(slugFor(1)).toBe("aab");
    expect(slugFor(1)).toBe(slugFor(1));
    expect(slugFor(32 ** 3)).toHaveLength(4);
  });
});

describe("LinksStore", () => {
  it("makes up slugs, keeps custom ones and refuses taken or reserved ones", () => {
    const store = new LinksStore();
    expect(store.create("https://a.example").slug).toBe("aab");
    expect(store.create("https://b.example", "my-link").slug).toBe("my-link");
    expect(() => store.create("https://c.example", "my-link")).toThrow(SlugTakenError);
    expect(() => store.create("https://c.example", "links")).toThrow(SlugTakenError);
  });

  it("counts visits and lists the most visited first", () => {
    const store = new LinksStore();
    store.create("https://a.example", "aaa-1", new Date("2026-10-01"));
    store.create("https://b.example", "bbb-2", new Date("2026-10-02"));
    expect(store.list().map((l) => l.slug)).toEqual(["bbb-2", "aaa-1"]);
    expect(store.visit("aaa-1")).toBe("https://a.example");
    expect(store.visit("nope")).toBeUndefined();
    expect(store.list().map((l) => [l.slug, l.visits])).toEqual([
      ["aaa-1", 1],
      ["bbb-2", 0],
    ]);
  });
});

describe("bearerToken", () => {
  it("reads the token of a Bearer header only", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});
