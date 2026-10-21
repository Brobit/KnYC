import type { Product } from "./product.js";

export class ProductsRepository {
  private readonly byId = new Map<string, Product>();

  save(product: Product): Product {
    this.byId.set(product.id, product);
    return product;
  }

  findById(id: string): Product | undefined {
    return this.byId.get(id);
  }

  all(): Product[] {
    return [...this.byId.values()];
  }
}
