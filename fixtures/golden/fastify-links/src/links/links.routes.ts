import type { FastifyPluginAsync } from "fastify";
import { createLinkSchema, slugParamsSchema, type CreateLinkBody, type Link, type LinkView } from "./link.js";
import { SlugTakenError } from "./links.store.js";

export interface LinksRoutesOptions {
  baseUrl: string;
}

export const toView = (link: Link, baseUrl: string): LinkView => ({ ...link, shortUrl: `${baseUrl}/r/${link.slug}` });

/** /links (the API) and /r/:slug (the redirect). Needs the store and auth plugins. */
export const linksRoutes: FastifyPluginAsync<LinksRoutesOptions> = async (app, { baseUrl }) => {
  app.get("/links", async () => app.links.list().map((l) => toView(l, baseUrl)));

  app.get<{ Params: { slug: string } }>("/links/:slug", { schema: slugParamsSchema }, async (request, reply) => {
    const link = app.links.get(request.params.slug);
    if (!link) return reply.code(404).send({ error: "no such link" });
    return toView(link, baseUrl);
  });

  app.post<{ Body: CreateLinkBody }>("/links", { schema: createLinkSchema, preHandler: app.requireAdmin }, async (request, reply) => {
    try {
      const link = app.links.create(request.body.url, request.body.slug);
      return reply.code(201).send(toView(link, baseUrl));
    } catch (error) {
      if (error instanceof SlugTakenError) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.delete<{ Params: { slug: string } }>("/links/:slug", { schema: slugParamsSchema, preHandler: app.requireAdmin }, async (request, reply) => {
    if (!app.links.remove(request.params.slug)) return reply.code(404).send({ error: "no such link" });
    return reply.code(204).send();
  });

  app.get<{ Params: { slug: string } }>("/r/:slug", { schema: slugParamsSchema }, async (request, reply) => {
    const url = app.links.visit(request.params.slug);
    if (!url) return reply.code(404).send({ error: "no such link" });
    return reply.redirect(url, 302);
  });
};
