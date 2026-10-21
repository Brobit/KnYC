export type Role = "customer" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  createdAt: string;
}

export type PublicUser = Omit<User, "passwordHash">;

export function toPublicUser({ passwordHash: _passwordHash, ...user }: User): PublicUser {
  return user;
}
