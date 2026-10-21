import express from "express";
import type { Config } from "./config.js";
import { errorHandler } from "./errors.js";
import { LinksService } from "./links/links.service.js";
import { LinksStore } from "./links/links.store.js";
import { linksApiRouter, redirectRouter } from "./links/links.routes.js";

export function createApp(config: Config, links = new LinksService(new LinksStore(), config.codeLength)) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api/links", linksApiRouter(links, config.baseUrl));
  // Must come last: it matches any single path segment.
  app.use("/", redirectRouter(links));

  app.use(errorHandler);
  return app;
}
