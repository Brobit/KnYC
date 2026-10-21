import { TokenService } from "./auth/tokens.js";
import { CartService } from "./cart/cart.service.js";
import type { Config } from "./config.js";
import { OrdersRepository } from "./orders/orders.repository.js";
import { OrdersService } from "./orders/orders.service.js";
import { MockPaymentProvider, type PaymentProvider } from "./payments/payment-provider.js";
import { ProductsRepository } from "./products/products.repository.js";
import { ProductsService } from "./products/products.service.js";
import { uuid, type IdGenerator } from "./shared/ids.js";
import { UsersRepository } from "./users/users.repository.js";
import { UsersService } from "./users/users.service.js";

export interface ContainerOverrides {
  newId?: IdGenerator;
  payments?: PaymentProvider;
}

// Builds every service once and wires their dependencies (manual dependency injection).
export function createContainer(config: Config, overrides: ContainerOverrides = {}) {
  const newId = overrides.newId ?? uuid;
  const payments = overrides.payments ?? new MockPaymentProvider();
  const tokens = new TokenService(config.jwtSecret, config.jwtExpiresInSeconds);

  const users = new UsersService(new UsersRepository(), tokens, newId);
  const products = new ProductsService(new ProductsRepository(), newId);
  const cart = new CartService(products);
  const orders = new OrdersService(new OrdersRepository(), cart, products, payments, newId);

  return { tokens, users, products, cart, orders, payments };
}

export type Container = ReturnType<typeof createContainer>;
