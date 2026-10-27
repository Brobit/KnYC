// React with Vite (#92, VISION §6 priority 1; golden repo fullstack-notes, its apps/web). Components
// are checked in a real browser (#89), against the original backend when the app calls one.

import { DEPLOYMENT_RULES, SETUP_RULES } from "./shared-rules.ts";
import type { Profile } from "./types.ts";

export const react: Profile = {
  id: "react",
  label: "React",
  kind: "frontend",
  trackRules: [
    ...SETUP_RULES,
    { glob: "{vite.config.*,eslint.config.*,postcss.config.*,tailwind.config.*}", track: "setup" },
    ...DEPLOYMENT_RULES,
    { glob: "**/*.{d.ts,types.ts}", track: "shared" },
  ],
  defaultTrack: "frontend",
  buildOrder: [
    "types and the API client (the functions that call the backend)",
    "pure helpers (formatting, filtering, sorting)",
    "custom hooks that hold state or load data",
    "small components that only display their props",
    "components that load or change data",
    "pages and routing",
    "the root App and main.tsx that mounts it",
  ],
  check: {
    hints: [
      "components and pages: \"ui\", a test in a real browser on the running app (what the page shows, clicking, typing)",
      "the API client, hooks' pure logic and helpers: the project's own tests where they cover them",
      "types and code no page shows yet: the project builds",
    ],
    fallback: "build",
  },
  // vite build bundles from main.tsx, which comes last; each step type-checks instead.
  stepBuild: "npx tsc --noEmit",
  // Vite takes its port on the command line, not from PORT.
  run: { scripts: ["dev", "start"], portEnv: "PORT", readyPaths: ["/"], port: 5173, portArgs: "-- --port {port} --strictPort" },
  lessonHints: [
    "A component is a function of its props that returns JSX; React calls it again whenever its props or state change.",
    "useState holds a value across renders; setting it re-renders the component. Never change state in place: build a new array or object.",
    "useEffect runs after a render, to load data or subscribe; its dependency array says when to run it again, and its cleanup undoes it.",
    "Lists need a stable key per item (an id, not the index) so React keeps each row's state.",
    "Lift state up: when two components need the same data, keep it in their closest common parent and pass it down with callbacks to change it.",
    "In development Vite serves the app and proxies /api to the backend (server.proxy in vite.config), so the page and the API share one origin.",
  ],
};
