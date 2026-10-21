import type { Link } from "./link.js";

export class LinksStore {
  private readonly byCode = new Map<string, Link>();

  has(code: string): boolean {
    return this.byCode.has(code);
  }

  get(code: string): Link | undefined {
    return this.byCode.get(code);
  }

  save(link: Link): Link {
    this.byCode.set(link.code, link);
    return link;
  }

  delete(code: string): boolean {
    return this.byCode.delete(code);
  }

  all(): Link[] {
    return [...this.byCode.values()];
  }
}
