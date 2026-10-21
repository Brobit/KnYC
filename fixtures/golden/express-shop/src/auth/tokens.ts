import jwt from "jsonwebtoken";
import type { Role } from "../users/user.js";

export interface TokenPayload {
  sub: string;
  role: Role;
}

export class TokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresInSeconds: number,
  ) {}

  sign(payload: TokenPayload): string {
    return jwt.sign(payload, this.secret, { expiresIn: this.expiresInSeconds });
  }

  // Returns null for any invalid, expired or tampered token.
  verify(token: string): TokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret);
      if (typeof decoded === "string" || typeof decoded.sub !== "string") return null;
      return { sub: decoded.sub, role: decoded.role as Role };
    } catch {
      return null;
    }
  }
}
