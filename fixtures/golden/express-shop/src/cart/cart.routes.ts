import { Router } from "express";
import { currentUserId, requireAuth } from "../auth/auth.middleware.js";
import type { TokenService } from "../auth/tokens.js";
import { validate } from "../shared/validate.js";
import { addToCartSchema, setQuantitySchema, type CartService } from "./cart.service.js";

export function cartRouter(cart: CartService, tokens: TokenService): Router {
  const router = Router();
  router.use(requireAuth(tokens));

  router.get("/", (req, res) => {
    res.json(cart.get(currentUserId(req)));
  });

  router.post("/items", (req, res) => {
    res.status(201).json(cart.add(currentUserId(req), validate(addToCartSchema, req.body)));
  });

  router.put("/items/:productId", (req, res) => {
    const { quantity } = validate(setQuantitySchema, req.body);
    res.json(cart.setQuantity(currentUserId(req), req.params.productId, quantity));
  });

  router.delete("/", (req, res) => {
    cart.clear(currentUserId(req));
    res.status(204).end();
  });

  return router;
}
