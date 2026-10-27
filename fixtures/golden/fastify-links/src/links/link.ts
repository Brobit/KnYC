export interface Link {
  slug: string;
  url: string;
  visits: number;
  createdAt: string;
}

/** A link as the API returns it: with its short URL. */
export interface LinkView extends Link {
  shortUrl: string;
}

export interface CreateLinkBody {
  url: string;
  /** A slug of your own; one is made up when it's missing. */
  slug?: string;
}

/** Route schemas: Fastify validates requests against them and answers 400 on its own. */
export const createLinkSchema = {
  body: {
    type: "object",
    required: ["url"],
    additionalProperties: false,
    properties: {
      url: { type: "string", pattern: "^https?://" },
      slug: { type: "string", pattern: "^[a-z0-9-]{3,32}$" },
    },
  },
} as const;

export const slugParamsSchema = {
  params: {
    type: "object",
    required: ["slug"],
    properties: { slug: { type: "string" } },
  },
} as const;
