# fastify-links (golden fixture)

A small link shortener API in Fastify 5, used to test the KnYC pipeline on a Fastify project (#97).
Size: small (~250 lines), **with tests**.

## Architecture

```
src/server.ts              entry point: loads config, builds the app, listens
src/app.ts                 buildApp(): registers the plugins in order, GET /health
src/config.ts              PORT, ADMIN_TOKEN, BASE_URL
src/links/link.ts          Link types and the route schemas (JSON Schema)
src/links/slug.ts          short slugs from a counter, reserved slugs
src/links/links.store.ts   in-memory store: create, list (most visited first), visit, remove
src/plugins/store.ts       fastify-plugin: app.decorate("links", new LinksStore())
src/plugins/auth.ts        fastify-plugin: app.requireAdmin, a Bearer-token preHandler
src/links/links.routes.ts  /links (API) and /r/:slug (redirect)
```

Expected build order: config → types and schemas → slugs → store → plugins → routes → app →
server.

## API

| Method | Path | |
|---|---|---|
| GET | /health | `{ status: "ok" }` |
| GET | /links | all links, most visited first |
| GET | /links/:slug | one link, 404 if missing |
| POST | /links | create (Bearer token; `url`, optional `slug`) → 201, 409 if the slug is taken |
| DELETE | /links/:slug | 204 (Bearer token) |
| GET | /r/:slug | 302 to the link's URL, counting the visit |

## Commands

```bash
npm install
npm run build
npm test
```
