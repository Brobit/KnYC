import { Router, type Request } from "express";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import type { TokenService } from "../auth/tokens.js";
import { validate } from "../shared/validate.js";
import { createProductSchema, listProductsSchema, updateProductSchema } from "./products.schemas.js";
import type { ProductsService } from "./products.service.js";

export function productsRouter(products: ProductsService, tokens: TokenService): Router {
  const router = Router();
  const authenticated = requireAuth(tokens);
  const admin = requireRole("admin");

  router.get("/", (req, res) => {
    res.json(products.list(validate(listProductsSchema, req.query)));
  });

  router.get("/:id", (req, res) => {
    const product = products.get(req.params.id);
    if (!product.active) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json(product);
  });

  router.post("/", authenticated, admin, (req, res) => {
    res.status(201).json(products.create(validate(createProductSchema, req.body)));
  });

  router.patch("/:id", authenticated, admin, (req: Request<{ id: string }>, res) => {
    res.json(products.update(req.params.id, validate(updateProductSchema, req.body)));
  });

  return router;
}
