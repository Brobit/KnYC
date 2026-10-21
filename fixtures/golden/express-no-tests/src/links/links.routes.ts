import { Router } from "express";
import type { Link } from "./link.js";
import type { LinksService } from "./links.service.js";

function present(link: Link, baseUrl: string) {
  return { ...link, shortUrl: `${baseUrl}/${link.code}` };
}

// JSON API under /api/links.
export function linksApiRouter(links: LinksService, baseUrl: string): Router {
  const router = Router();

  router.post("/", (req, res) => {
    res.status(201).json(present(links.create(req.body ?? {}), baseUrl));
  });

  router.get("/top", (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 10) || 10, 50);
    res.json(links.topLinks(limit).map((link) => present(link, baseUrl)));
  });

  router.get("/:code", (req, res) => {
    res.json(present(links.get(req.params.code), baseUrl));
  });

  router.delete("/:code", (req, res) => {
    links.remove(req.params.code);
    res.status(204).end();
  });

  return router;
}

// Public redirect: GET /:code → 302 to the long URL.
export function redirectRouter(links: LinksService): Router {
  const router = Router();

  router.get("/:code", (req, res) => {
    res.redirect(302, links.visit(req.params.code));
  });

  return router;
}
