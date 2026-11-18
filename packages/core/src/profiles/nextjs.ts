// Next.js with the app router (#93, VISION §6 priority 2; golden repo nextjs-notes). One package
// holds both tracks: pages and components are the frontend, route handlers (`app/api/**`) and
// server-only code the backend. Both run on `next dev`: the frontend is checked in a browser, the
// backend with HTTP requests; each step type-checks (`next build` needs the whole app).

import { DATABASE_RULES, DEPLOYMENT_RULES, SETUP_RULES } from "./shared-rules.ts";
import type { Profile } from "./types.ts";

const run = { scripts: ["dev", "start"], portEnv: "PORT", readyPaths: ["/"], port: 3000, portArgs: "-- -p {port}" };

export const nextjs: Profile = {
  id: "nextjs",
  label: "Next.js",
  kind: "frontend",
  trackRules: [
    ...SETUP_RULES,
    { glob: "{next.config.*,next-env.d.ts,postcss.config.*,tailwind.config.*}", track: "setup" },
    ...DATABASE_RULES,
    ...DEPLOYMENT_RULES,
    { glob: "{app,src/app}/api/**", track: "backend" },
    { glob: "**/route.{ts,js}", track: "backend" },
    { glob: "{server,src/server,lib/server,src/lib/server}/**", track: "backend" },
    { glob: "**/*.server.{ts,tsx,js}", track: "backend" },
    { glob: "{middleware,src/middleware}.{ts,js}", track: "backend" },
    { glob: "**/{types,shared}/**", track: "shared" },
    { glob: "**/*.{d.ts,types.ts}", track: "shared" },
    { glob: "**/types.ts", track: "shared" },
  ],
  defaultTrack: "frontend",
  buildOrder: [
    "types and the API client (the functions that call the route handlers)",
    "pure helpers (formatting, filtering, sorting)",
    "custom hooks that hold state or load data",
    "small components that only display their props",
    "client components that load or change data",
    "the root layout and the pages",
  ],
  check: {
    hints: [
      "components and pages: \"ui\", a test in a real browser on `next dev` (what the page shows, clicking, typing)",
      "the API client, hooks' pure logic and helpers: the project's own tests where they cover them",
      "types and code no page shows yet: the project type-checks",
    ],
    fallback: "build",
  },
  // The route types next dev and next build write under .next (the tsconfig includes them) name the
  // pages that existed then: a UI check's mount page, gone since, would fail the next step's check.
  stepBuild: `node -e "for (const d of ['.next/types', '.next/dev/types']) require('fs').rmSync(d, { recursive: true, force: true })" && npx tsc --noEmit`,
  run,
  uiMount: "next-app",
  entryFiles: ["app/page.tsx", "src/app/page.tsx"],
  lessonHints: [
    "The app router maps folders to URLs: app/page.tsx is /, app/notes/page.tsx is /notes; layout.tsx wraps the pages below it.",
    "Components are server components by default: they render on the server and can't use state or effects. \"use client\" at the top of a file makes it, and what it imports, run in the browser too.",
    "A server component can render a client component and pass it serializable props; the client component handles clicks, typing and state.",
    "Route handlers (app/api/…/route.ts) export a function per HTTP method; they take a Request and return a Response, like a small API inside the app.",
    "In development, `next dev` compiles each route the first time it's requested; `next build` checks and compiles the whole app for production.",
  ],
  tracks: {
    backend: {
      kind: "backend",
      defaultTrack: "backend",
      buildOrder: [
        "the server-side data store and its operations",
        "a health route",
        "route handlers that read",
        "route handlers that change data, with their validation",
      ],
      check: {
        hints: [
          "route handlers: \"http\", requests to the running `next dev` server (status codes and JSON bodies)",
          "the store: the project's own tests where they cover it",
        ],
        fallback: "build",
      },
      run: { ...run, readyPaths: ["/api/health", "/"] },
      lessonHints: [
        "A route handler lives in app/api/<path>/route.ts and exports GET, POST, PATCH or DELETE; the folder path is the URL.",
        "A dynamic segment ([id]) gives the handler a `params` promise: `const { id } = await params`.",
        "`Response.json(data, { status })` sends JSON with a status code; `await request.json()` reads the body.",
        "Route handlers run on the server only: they can use the store, secrets and the file system; the browser only sees their responses.",
        "In development, modules reload on every change: keep server state on globalThis so it survives the reloads.",
      ],
    },
  },
};
