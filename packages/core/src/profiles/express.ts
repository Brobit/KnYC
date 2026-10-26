// Express (M1's golden repos: express-notes, express-shop, express-no-tests).

import { DATABASE_RULES, DEPLOYMENT_RULES, SETUP_RULES } from "./shared-rules.ts";
import type { Profile } from "./types.ts";

export const express: Profile = {
  id: "express",
  label: "Express",
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
    "configuration and shared types",
    "error classes and error-handling helpers",
    "data models (types, interfaces)",
    "storage (in-memory stores, repositories)",
    "validation of request input",
    "services with the business rules",
    "middleware (auth, logging)",
    "routers, one feature at a time",
    "the app factory that wires routers and middleware",
    "the server entry point that listens on a port",
  ],
  check: {
    hints: [
      "routes and the app: HTTP requests against the running app (status codes, JSON bodies)",
      "stores, services, validation: unit tests calling the functions directly",
      "pure types and interfaces: the project builds (tsc)",
    ],
    fallback: "unit-test",
  },
  run: { scripts: ["start", "dev"], portEnv: "PORT", readyPaths: ["/health", "/"] },
  lessonHints: [
    "An Express app is a stack of middleware: each one gets (req, res, next) and either answers or calls next().",
    "Routers group the routes of one feature and are mounted on a path prefix with app.use('/prefix', router).",
    "Error-handling middleware takes four arguments (err, req, res, next) and goes after the routes.",
    "Building the app in a factory (createApp) and listening in a separate entry point keeps the app testable without a port.",
  ],
};
