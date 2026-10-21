import request from "supertest";
import { describe, expect, it } from "vitest";
import { auth, seedShop } from "./helpers.js";

describe("/cart", () => {
  it("adds items, computes totals and removes a line with quantity 0", async () => {
    const { app, customer, keyboard, mouse } = await seedShop();
    await request(app).post("/cart/items").set(auth(customer.token)).send({ productId: keyboard.id, quantity: 2 });
    const cart = await request(app).post("/cart/items").set(auth(customer.token)).send({ productId: mouse.id });
    expect(cart.body.totalCents).toBe(2 * 8000 + 3000);

    const updated = await request(app).put(`/cart/items/${mouse.id}`).set(auth(customer.token)).send({ quantity: 0 });
    expect(updated.body.lines).toHaveLength(1);
  });
});

describe("/orders", () => {
  it("checks out the cart, decrements stock and empties the cart", async () => {
    const { app, container, customer, keyboard } = await seedShop();
    await request(app).post("/cart/items").set(auth(customer.token)).send({ productId: keyboard.id, quantity: 2 });

    const order = await request(app).post("/orders").set(auth(customer.token)).send({ cardToken: "tok_ok" });
    expect(order.status).toBe(201);
    expect(order.body).toMatchObject({ status: "paid", totalCents: 16000 });
    expect(container.products.get(keyboard.id).stock).toBe(3);
    expect((await request(app).get("/cart").set(auth(customer.token))).body.lines).toHaveLength(0);
  });

  it("refuses an empty cart, too little stock and declined cards", async () => {
    const { app, container, customer, mouse } = await seedShop();
    expect((await request(app).post("/orders").set(auth(customer.token)).send({ cardToken: "tok_ok" })).status).toBe(400);

    await request(app).post("/cart/items").set(auth(customer.token)).send({ productId: mouse.id, quantity: 2 });
    expect((await request(app).post("/orders").set(auth(customer.token)).send({ cardToken: "tok_ok" })).status).toBe(400);

    await request(app).put(`/cart/items/${mouse.id}`).set(auth(customer.token)).send({ quantity: 1 });
    const declined = await request(app).post("/orders").set(auth(customer.token)).send({ cardToken: "tok_declined" });
    expect(declined.status).toBe(402);
    expect(container.products.get(mouse.id).stock).toBe(1);
  });

  it("lets a customer cancel a paid order and refunds it", async () => {
    const { app, container, customer, keyboard } = await seedShop();
    await request(app).post("/cart/items").set(auth(customer.token)).send({ productId: keyboard.id });
    const order = await request(app).post("/orders").set(auth(customer.token)).send({ cardToken: "tok_ok" });

    const cancelled = await request(app)
      .patch(`/orders/${order.body.id}/status`)
      .set(auth(customer.token))
      .send({ status: "cancelled" });
    expect(cancelled.body.status).toBe("cancelled");
    expect(container.products.get(keyboard.id).stock).toBe(5);
    expect(container.payments).toHaveProperty("refunded", [order.body.paymentReference]);
  });

  it("only lets admins ship, and enforces the status flow", async () => {
    const { app, admin, customer, keyboard } = await seedShop();
    await request(app).post("/cart/items").set(auth(customer.token)).send({ productId: keyboard.id });
    const order = await request(app).post("/orders").set(auth(customer.token)).send({ cardToken: "tok_ok" });
    const path = `/orders/${order.body.id}/status`;

    expect((await request(app).patch(path).set(auth(customer.token)).send({ status: "shipped" })).status).toBe(403);
    expect((await request(app).patch(path).set(auth(admin.token)).send({ status: "delivered" })).status).toBe(400);
    expect((await request(app).patch(path).set(auth(admin.token)).send({ status: "shipped" })).body.status).toBe("shipped");
    expect((await request(app).patch(path).set(auth(customer.token)).send({ status: "cancelled" })).status).toBe(400);
  });

  it("hides other users' orders", async () => {
    const { app, customer, keyboard } = await seedShop();
    await request(app).post("/cart/items").set(auth(customer.token)).send({ productId: keyboard.id });
    const order = await request(app).post("/orders").set(auth(customer.token)).send({ cardToken: "tok_ok" });
    const bob = await request(app).post("/auth/register").send({ email: "bob@shop.test", name: "Bob", password: "password123" });
    expect((await request(app).get(`/orders/${order.body.id}`).set(auth(bob.body.token))).status).toBe(403);
    expect((await request(app).get("/orders").set(auth(customer.token))).body).toHaveLength(1);
  });
});
