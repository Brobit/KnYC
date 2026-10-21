import type { User } from "./user.js";

export class UsersRepository {
  private readonly byId = new Map<string, User>();

  save(user: User): User {
    this.byId.set(user.id, user);
    return user;
  }

  findById(id: string): User | undefined {
    return this.byId.get(id);
  }

  findByEmail(email: string): User | undefined {
    const normalized = email.toLowerCase();
    return [...this.byId.values()].find((user) => user.email === normalized);
  }

  count(): number {
    return this.byId.size;
  }
}
