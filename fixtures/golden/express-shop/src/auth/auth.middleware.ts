import type { NextFunction, Request, Response } from "express";
import type { Role } from "../users/user.js";
import { forbidden, unauthorized } from "../shared/errors.js";
import type { TokenPayload, TokenService } from "./tokens.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: TokenPayload;
  }
}

export function requireAuth(tokens: TokenService) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const [type, token] = req.headers.authorization?.split(" ") ?? [];
    if (type !== "Bearer" || !token) return next(unauthorized());
    const payload = tokens.verify(token);
    if (!payload) return next(unauthorized("Invalid or expired token"));
    req.user = payload;
    next();
  };
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== role) return next(forbidden());
    next();
  };
}

// For handlers that run after requireAuth.
export function currentUserId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.sub;
}
