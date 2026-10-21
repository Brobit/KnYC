import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/password.js";
import type { TokenService } from "../auth/tokens.js";
import { conflict, notFound, unauthorized } from "../shared/errors.js";
import type { IdGenerator } from "../shared/ids.js";
import { toPublicUser, type PublicUser, type User } from "./user.js";
import type { UsersRepository } from "./users.repository.js";

export const registerSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
});

export interface AuthResult {
  user: PublicUser;
  token: string;
}

export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly tokens: TokenService,
    private readonly newId: IdGenerator,
  ) {}

  // The first account ever created becomes the admin, so a fresh shop can be managed.
  async register(input: z.infer<typeof registerSchema>): Promise<AuthResult> {
    if (this.users.findByEmail(input.email)) throw conflict("Email already registered");
    const user: User = {
      id: this.newId(),
      email: input.email,
      name: input.name,
      role: this.users.count() === 0 ? "admin" : "customer",
      passwordHash: await hashPassword(input.password),
      createdAt: new Date().toISOString(),
    };
    this.users.save(user);
    return this.authResult(user);
  }

  async login(input: z.infer<typeof loginSchema>): Promise<AuthResult> {
    const user = this.users.findByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw unauthorized("Wrong email or password");
    }
    return this.authResult(user);
  }

  getProfile(id: string): PublicUser {
    const user = this.users.findById(id);
    if (!user) throw notFound("User");
    return toPublicUser(user);
  }

  private authResult(user: User): AuthResult {
    return { user: toPublicUser(user), token: this.tokens.sign({ sub: user.id, role: user.role }) };
  }
}
