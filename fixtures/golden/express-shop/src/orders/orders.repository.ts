import type { Order } from "./order.js";

export class OrdersRepository {
  private readonly byId = new Map<string, Order>();

  save(order: Order): Order {
    this.byId.set(order.id, order);
    return order;
  }

  findById(id: string): Order | undefined {
    return this.byId.get(id);
  }

  findByUser(userId: string): Order[] {
    return [...this.byId.values()]
      .filter((order) => order.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  all(): Order[] {
    return [...this.byId.values()];
  }
}
