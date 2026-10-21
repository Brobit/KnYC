import { z } from "zod";
import type { CartService } from "../cart/cart.service.js";
import type { PaymentProvider } from "../payments/payment-provider.js";
import type { ProductsService } from "../products/products.service.js";
import { badRequest, forbidden, HttpError, notFound } from "../shared/errors.js";
import type { IdGenerator } from "../shared/ids.js";
import { transitions, type Order, type OrderStatus } from "./order.js";
import type { OrdersRepository } from "./orders.repository.js";

export const checkoutSchema = z.object({
  cardToken: z.string().min(1),
});

export const updateStatusSchema = z.object({
  status: z.enum(["shipped", "delivered", "cancelled"]),
});

export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly cart: CartService,
    private readonly products: ProductsService,
    private readonly payments: PaymentProvider,
    private readonly newId: IdGenerator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Reserve stock, then charge. If the charge fails, the stock is put back.
  async checkout(userId: string, cardToken: string): Promise<Order> {
    const cart = this.cart.get(userId);
    if (cart.lines.length === 0) throw badRequest("Cart is empty");

    const lines = cart.lines.map(({ productId, name, unitPriceCents, quantity }) => ({
      productId,
      name,
      unitPriceCents,
      quantity,
    }));
    this.products.reserveStock(lines);

    const payment = await this.payments.charge(cart.totalCents, cardToken);
    if (!payment.ok || !payment.reference) {
      this.products.releaseStock(lines);
      throw new HttpError(402, `Payment failed: ${payment.reason ?? "unknown error"}`);
    }

    const order = this.orders.save({
      id: this.newId(),
      userId,
      lines,
      totalCents: cart.totalCents,
      status: "paid",
      paymentReference: payment.reference,
      createdAt: this.now().toISOString(),
    });
    this.cart.clear(userId);
    return order;
  }

  listForUser(userId: string): Order[] {
    return this.orders.findByUser(userId);
  }

  getForUser(userId: string, orderId: string, isAdmin = false): Order {
    const order = this.orders.findById(orderId);
    if (!order) throw notFound("Order");
    if (order.userId !== userId && !isAdmin) throw forbidden();
    return order;
  }

  // Customers may cancel their own paid orders; every other change is admin-only.
  async changeStatus(userId: string, orderId: string, status: OrderStatus, isAdmin: boolean): Promise<Order> {
    const order = this.getForUser(userId, orderId, isAdmin);
    if (!isAdmin && status !== "cancelled") throw forbidden("Only admins can update shipping");
    if (!transitions[order.status].includes(status)) {
      throw badRequest(`Cannot change order from ${order.status} to ${status}`);
    }
    if (status === "cancelled") {
      this.products.releaseStock(order.lines);
      await this.payments.refund(order.paymentReference);
    }
    return this.orders.save({ ...order, status });
  }
}
