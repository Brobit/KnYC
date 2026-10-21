import { z } from "zod";
import { badRequest } from "../shared/errors.js";
import type { ProductsService } from "../products/products.service.js";

export const addToCartSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
});

export const setQuantitySchema = z.object({
  quantity: z.number().int().min(0).max(99),
});

export interface CartLine {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface Cart {
  lines: CartLine[];
  totalCents: number;
}

// One cart per user, kept in memory as productId → quantity.
export class CartService {
  private readonly carts = new Map<string, Map<string, number>>();

  constructor(private readonly products: ProductsService) {}

  get(userId: string): Cart {
    const lines = [...this.quantities(userId)].map(([productId, quantity]) => {
      const product = this.products.get(productId);
      return {
        productId,
        name: product.name,
        unitPriceCents: product.priceCents,
        quantity,
        lineTotalCents: product.priceCents * quantity,
      };
    });
    return { lines, totalCents: lines.reduce((sum, line) => sum + line.lineTotalCents, 0) };
  }

  add(userId: string, input: z.infer<typeof addToCartSchema>): Cart {
    const product = this.products.get(input.productId);
    if (!product.active) throw badRequest(`${product.name} is no longer available`);
    const cart = this.quantities(userId);
    cart.set(input.productId, (cart.get(input.productId) ?? 0) + input.quantity);
    return this.get(userId);
  }

  // Quantity 0 removes the line.
  setQuantity(userId: string, productId: string, quantity: number): Cart {
    const cart = this.quantities(userId);
    if (!cart.has(productId)) throw badRequest("Product is not in the cart");
    if (quantity === 0) cart.delete(productId);
    else cart.set(productId, quantity);
    return this.get(userId);
  }

  clear(userId: string): void {
    this.carts.delete(userId);
  }

  private quantities(userId: string): Map<string, number> {
    let cart = this.carts.get(userId);
    if (!cart) {
      cart = new Map();
      this.carts.set(userId, cart);
    }
    return cart;
  }
}
