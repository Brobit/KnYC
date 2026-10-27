import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { linksRoutes } from "./links/links.routes.js";
import { authPlugin } from "./plugins/auth.js";
import { storePlugin } from "./plugins/store.js";

/** The app, its plugins registered in order; ready for app.inject() in tests or listen(). */
export async function buildApp(config: Config, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(storePlugin);
  await app.register(authPlugin, { adminToken: config.adminToken });
  app.get("/health", async () => ({ status: "ok" }));
  await app.register(linksRoutes, { baseUrl: config.baseUrl });
  return app;
}
