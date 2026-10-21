import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createContainer } from "../src/container.js";
import { sequentialIds } from "../src/shared/ids.js";

export function testApp() {
  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret" });
  const container = createContainer(config, { newId: sequentialIds("id") });
  return { app: createApp(config, container), container };
}

export async function registerUser(app: ReturnType<typeof testApp>["app"], email: string) {
  const res = await request(app).post("/auth/register").send({ email, name: "Test", password: "password123" });
  return { token: res.body.token as string, user: res.body.user };
}

// The first registered user is the admin.
export async function seedShop() {
  const { app, container } = testApp();
  const admin = await registerUser(app, "admin@shop.test");
  const customer = await registerUser(app, "alice@shop.test");
  const keyboard = container.products.create({
    name: "Keyboard",
    description: "Mechanical",
    priceCents: 8000,
    stock: 5,
    category: "desk",
  });
  const mouse = container.products.create({
    name: "Mouse",
    description: "Wireless",
    priceCents: 3000,
    stock: 1,
    category: "desk",
  });
  return { app, container, admin, customer, keyboard, mouse };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
