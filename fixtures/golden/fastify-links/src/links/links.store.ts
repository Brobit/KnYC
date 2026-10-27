import type { Link } from "./link.js";
import { RESERVED_SLUGS, slugFor } from "./slug.js";

export class SlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`the slug "${slug}" is already taken`);
  }
}

/** Short links kept in memory. */
export class LinksStore {
  private readonly links = new Map<string, Link>();
  private counter = 0;

  create(url: string, slug?: string, now: Date = new Date()): Link {
    const chosen = slug ?? this.nextFreeSlug();
    if (this.links.has(chosen) || RESERVED_SLUGS.has(chosen)) throw new SlugTakenError(chosen);
    const link: Link = { slug: chosen, url, visits: 0, createdAt: now.toISOString() };
    this.links.set(chosen, link);
    return { ...link };
  }

  get(slug: string): Link | undefined {
    const link = this.links.get(slug);
    return link && { ...link };
  }

  /** Most visited first, then the newest. */
  list(): Link[] {
    return [...this.links.values()].sort((a, b) => b.visits - a.visits || b.createdAt.localeCompare(a.createdAt)).map((l) => ({ ...l }));
  }

  /** Counts a visit and returns where to go, or undefined for an unknown slug. */
  visit(slug: string): string | undefined {
    const link = this.links.get(slug);
    if (!link) return undefined;
    link.visits += 1;
    return link.url;
  }

  remove(slug: string): boolean {
    return this.links.delete(slug);
  }

  private nextFreeSlug(): string {
    let slug: string;
    do slug = slugFor(++this.counter);
    while (this.links.has(slug) || RESERVED_SLUGS.has(slug));
    return slug;
  }
}
