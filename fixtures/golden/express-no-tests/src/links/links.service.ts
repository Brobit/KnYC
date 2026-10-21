import { HttpError } from "../errors.js";
import { generateCode, isValidAlias, RESERVED_CODES, type Random } from "./code-generator.js";
import type { Link } from "./link.js";
import type { LinksStore } from "./links.store.js";

export interface CreateLinkInput {
  url: unknown;
  alias?: unknown;
  expiresInMinutes?: unknown;
}

function parseUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "url is required");
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new HttpError(400, "url must be a valid http(s) URL");
  }
}

export class LinksService {
  constructor(
    private readonly store: LinksStore,
    private readonly codeLength: number,
    private readonly random: Random = Math.random,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: CreateLinkInput): Link {
    const url = parseUrl(input.url);
    const code = input.alias === undefined ? this.uniqueCode() : this.checkAlias(input.alias);

    let expiresAt: string | null = null;
    if (input.expiresInMinutes !== undefined) {
      const minutes = Number(input.expiresInMinutes);
      if (!Number.isInteger(minutes) || minutes < 1) {
        throw new HttpError(400, "expiresInMinutes must be a positive integer");
      }
      expiresAt = new Date(this.now().getTime() + minutes * 60_000).toISOString();
    }

    return this.store.save({
      code,
      url,
      createdAt: this.now().toISOString(),
      expiresAt,
      visits: 0,
      lastVisitAt: null,
    });
  }

  get(code: string): Link {
    const link = this.store.get(code);
    if (!link) throw new HttpError(404, "Link not found");
    return link;
  }

  // Resolves a code for a redirect and counts the visit. Expired links answer 410 Gone.
  visit(code: string): string {
    const link = this.get(code);
    if (link.expiresAt && new Date(link.expiresAt) <= this.now()) {
      throw new HttpError(410, "Link expired");
    }
    this.store.save({ ...link, visits: link.visits + 1, lastVisitAt: this.now().toISOString() });
    return link.url;
  }

  remove(code: string): void {
    if (!this.store.delete(code)) throw new HttpError(404, "Link not found");
  }

  topLinks(limit: number): Link[] {
    return this.store
      .all()
      .sort((a, b) => b.visits - a.visits)
      .slice(0, limit);
  }

  private checkAlias(alias: unknown): string {
    if (typeof alias !== "string" || !isValidAlias(alias)) {
      throw new HttpError(400, "alias must be 3-32 letters, digits, '-' or '_'");
    }
    if (RESERVED_CODES.has(alias.toLowerCase())) throw new HttpError(400, "alias is reserved");
    if (this.store.has(alias)) throw new HttpError(409, "alias already taken");
    return alias;
  }

  private uniqueCode(): string {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateCode(this.codeLength, this.random);
      if (!this.store.has(code) && !RESERVED_CODES.has(code.toLowerCase())) return code;
    }
    throw new HttpError(503, "Could not generate a unique code, try again");
  }
}
