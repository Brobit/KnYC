import express from "express";
import { cartRouter } from "./cart/cart.routes.js";
import type { Config } from "./config.js";
import { createContainer, type Container } from "./container.js";
import { ordersRouter } from "./orders/orders.routes.js";
import { productsRouter } from "./products/products.routes.js";
import { errorHandler, notFoundHandler } from "./shared/errors.js";
import { requestLogger } from "./shared/logger.js";
import { authRouter, meRouter } from "./users/users.routes.js";

export function createApp(config: Config, container: Container = createContainer(config)) {
  const app = express();
  app.use(express.json());
  if (config.logRequests) app.use(requestLogger);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", authRouter(container.users));
  app.use("/me", meRouter(container.users, container.tokens));
  app.use("/products", productsRouter(container.products, container.tokens));
  app.use("/cart", cartRouter(container.cart, container.tokens));
  app.use("/orders", ordersRouter(container.orders, container.tokens));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
