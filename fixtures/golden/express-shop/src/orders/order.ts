export type OrderStatus = "paid" | "shipped" | "delivered" | "cancelled";

export interface OrderLine {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface Order {
  id: string;
  userId: string;
  lines: OrderLine[];
  totalCents: number;
  status: OrderStatus;
  paymentReference: string;
  createdAt: string;
}

// Allowed status changes. Cancelling is only possible before shipping.
export const transitions: Record<OrderStatus, OrderStatus[]> = {
  paid: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};
