import { Router } from "express";
import { currentUserId, requireAuth } from "../auth/auth.middleware.js";
import type { TokenService } from "../auth/tokens.js";
import { validate } from "../shared/validate.js";
import { checkoutSchema, updateStatusSchema, type OrdersService } from "./orders.service.js";

export function ordersRouter(orders: OrdersService, tokens: TokenService): Router {
  const router = Router();
  router.use(requireAuth(tokens));

  router.post("/", async (req, res) => {
    const { cardToken } = validate(checkoutSchema, req.body);
    res.status(201).json(await orders.checkout(currentUserId(req), cardToken));
  });

  router.get("/", (req, res) => {
    res.json(orders.listForUser(currentUserId(req)));
  });

  router.get("/:id", (req, res) => {
    res.json(orders.getForUser(currentUserId(req), req.params.id, req.user?.role === "admin"));
  });

  router.patch("/:id/status", async (req, res) => {
    const { status } = validate(updateStatusSchema, req.body);
    res.json(await orders.changeStatus(currentUserId(req), req.params.id, status, req.user?.role === "admin"));
  });

  return router;
}
