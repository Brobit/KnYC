import request from "supertest";
import { describe, expect, it } from "vitest";
import { paginate } from "../src/shared/pagination.js";
import { auth, seedShop } from "./helpers.js";

describe("paginate", () => {
  it("slices items and computes totals", () => {
    const page = paginate([1, 2, 3, 4, 5], { page: 2, pageSize: 2 });
    expect(page).toEqual({ items: [3, 4], page: 2, pageSize: 2, total: 5, totalPages: 3 });
  });
});

describe("/products", () => {
  it("lists, searches and sorts active products", async () => {
    const { app } = await seedShop();
    const all = await request(app).get("/products");
    expect(all.body.items.map((p: { name: string }) => p.name)).toEqual(["Keyboard", "Mouse"]);

    const search = await request(app).get("/products?q=wireless");
    expect(search.body.total).toBe(1);

    const byPrice = await request(app).get("/products?sort=price");
    expect(byPrice.body.items[0].name).toBe("Mouse");
  });

  it("lets only admins create and update products", async () => {
    const { app, admin, customer, keyboard } = await seedShop();
    const product = { name: "Lamp", priceCents: 2500, stock: 3, category: "Desk" };

    expect((await request(app).post("/products").send(product)).status).toBe(401);
    expect((await request(app).post("/products").set(auth(customer.token)).send(product)).status).toBe(403);

    const created = await request(app).post("/products").set(auth(admin.token)).send(product);
    expect(created.status).toBe(201);
    expect(created.body.category).toBe("desk");

    const hidden = await request(app).patch(`/products/${keyboard.id}`).set(auth(admin.token)).send({ active: false });
    expect(hidden.body.active).toBe(false);
    expect((await request(app).get(`/products/${keyboard.id}`)).status).toBe(404);
  });

  it("validates input", async () => {
    const { app, admin } = await seedShop();
    const res = await request(app).post("/products").set(auth(admin.token)).send({ name: "", priceCents: -1 });
    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThan(0);
  });
});
