import { Router } from "express";
import { currentUserId, requireAuth } from "../auth/auth.middleware.js";
import type { TokenService } from "../auth/tokens.js";
import { validate } from "../shared/validate.js";
import { loginSchema, registerSchema, type UsersService } from "./users.service.js";

export function authRouter(users: UsersService): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    res.status(201).json(await users.register(validate(registerSchema, req.body)));
  });

  router.post("/login", async (req, res) => {
    res.json(await users.login(validate(loginSchema, req.body)));
  });

  return router;
}

export function meRouter(users: UsersService, tokens: TokenService): Router {
  const router = Router();
  router.use(requireAuth(tokens));

  router.get("/", (req, res) => {
    res.json(users.getProfile(currentUserId(req)));
  });

  return router;
}
