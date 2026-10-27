// Fastify (#97; golden repo fastify-links). A plugin decorates the app (`app.links`) through a
// module augmentation; knyc-analyzer orders what uses the member after the plugin.

import { DATABASE_RULES, DEPLOYMENT_RULES, SETUP_RULES } from "./shared-rules.ts";
import type { Profile } from "./types.ts";

export const fastify: Profile = {
  id: "fastify",
  label: "Fastify",
  kind: "backend",
  trackRules: [
    ...SETUP_RULES,
    ...DATABASE_RULES,
    ...DEPLOYMENT_RULES,
    { glob: "**/{types,shared,common}/**", track: "shared" },
    { glob: "**/*.{d.ts,types.ts}", track: "shared" },
  ],
  defaultTrack: "backend",
  buildOrder: [
    "configuration",
    "types and the JSON schemas of the routes",
    "storage and the business logic (plain classes and functions)",
    "plugins that decorate the app (app.decorate) or add hooks, wrapped in fastify-plugin",
    "route plugins, one feature at a time, with their schemas and preHandlers",
    "the app factory that registers the plugins in order",
    "the server entry point that listens on a port",
  ],
  check: {
    hints: [
      "routes and the app: requests through app.inject() on the app the factory builds (status codes, JSON bodies, headers), or HTTP requests against the running server",
      "stores, helpers and hooks' logic: unit tests calling them directly",
      "types and schemas alone: the project builds (tsc)",
    ],
    fallback: "unit-test",
  },
  run: { scripts: ["start", "dev"], portEnv: "PORT", readyPaths: ["/health", "/"] },
  lessonHints: [
    "Everything in Fastify is a plugin: an async function (app, options) registered with app.register(), which gets its own encapsulated scope.",
    "app.decorate('name', value) adds app.name; wrapping the plugin in fastify-plugin (fp) lifts that out of its scope so sibling plugins and routes see it. A `declare module 'fastify'` block tells TypeScript about the new member.",
    "A route's schema (body, params, querystring, response) is JSON Schema: Fastify validates the request against it and answers 400 on its own, before the handler runs.",
    "Hooks (onRequest, preHandler…) run around handlers; a preHandler that sends a reply (401) stops the request there.",
    "Handlers can return a value (sent as JSON) or use reply.code(201).send(...); reply.redirect(url, 302) sends a redirect.",
    "app.inject() sends a request to the app without opening a port: the usual way to test Fastify routes.",
  ],
};
