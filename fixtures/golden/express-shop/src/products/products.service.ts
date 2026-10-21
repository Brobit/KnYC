import { badRequest, notFound } from "../shared/errors.js";
import type { IdGenerator } from "../shared/ids.js";
import { paginate, type Page } from "../shared/pagination.js";
import type { Product } from "./product.js";
import type { ProductsRepository } from "./products.repository.js";
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from "./products.schemas.js";

const sorters: Record<ListProductsQuery["sort"], (a: Product, b: Product) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  price: (a, b) => a.priceCents - b.priceCents,
  "-price": (a, b) => b.priceCents - a.priceCents,
};

export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly newId: IdGenerator,
  ) {}

  // Customers only see active products; admins see everything.
  list(query: ListProductsQuery, includeInactive = false): Page<Product> {
    const q = query.q?.toLowerCase();
    const items = this.products
      .all()
      .filter((p) => includeInactive || p.active)
      .filter((p) => !query.category || p.category === query.category)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
      .sort(sorters[query.sort]);
    return paginate(items, query);
  }

  get(id: string): Product {
    const product = this.products.findById(id);
    if (!product) throw notFound("Product");
    return product;
  }

  create(input: CreateProductInput): Product {
    return this.products.save({ id: this.newId(), active: true, ...input });
  }

  update(id: string, input: UpdateProductInput): Product {
    return this.products.save({ ...this.get(id), ...input });
  }

  // Called by orders: fails if any line can't be served, so stock never goes negative.
  reserveStock(lines: { productId: string; quantity: number }[]): void {
    for (const line of lines) {
      const product = this.get(line.productId);
      if (!product.active) throw badRequest(`${product.name} is no longer available`);
      if (product.stock < line.quantity) throw badRequest(`Not enough stock for ${product.name}`);
    }
    for (const line of lines) {
      const product = this.get(line.productId);
      this.products.save({ ...product, stock: product.stock - line.quantity });
    }
  }

  releaseStock(lines: { productId: string; quantity: number }[]): void {
    for (const line of lines) {
      const product = this.get(line.productId);
      this.products.save({ ...product, stock: product.stock + line.quantity });
    }
  }
}
