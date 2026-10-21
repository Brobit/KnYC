import { z } from "zod";
import { paginationSchema } from "../shared/pagination.js";

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  priceCents: z.number().int().positive(),
  stock: z.number().int().min(0),
  category: z.string().trim().min(1).transform((c) => c.toLowerCase()),
});

export const updateProductSchema = createProductSchema.partial().extend({
  active: z.boolean().optional(),
});

export const listProductsSchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  category: z
    .string()
    .trim()
    .transform((c) => c.toLowerCase())
    .optional(),
  sort: z.enum(["name", "price", "-price"]).default("name"),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsSchema>;
