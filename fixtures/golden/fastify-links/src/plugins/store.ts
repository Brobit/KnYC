import fp from "fastify-plugin";
import { LinksStore } from "../links/links.store.js";

declare module "fastify" {
  interface FastifyInstance {
    links: LinksStore;
  }
}

/** Puts one LinksStore on the app (app.links), visible to every route plugin: fastify-plugin
 * keeps the decoration out of the plugin's own encapsulated scope. */
export const storePlugin = fp(
  async (app) => {
    app.decorate("links", new LinksStore());
  },
  { name: "links-store" },
);
