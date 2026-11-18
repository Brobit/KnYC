// Vue 3 with Vite (#94, VISION §6; golden repo vue-notes): single-file components, a Pinia store,
// vue-router pages. Checked as React is (#92): in a real browser, components mounted alone on a
// page of their own until the app shows them; each step type-checks with vue-tsc.

import { DEPLOYMENT_RULES, SETUP_RULES } from "./shared-rules.ts";
import type { Profile } from "./types.ts";

export const vue: Profile = {
  id: "vue",
  label: "Vue",
  kind: "frontend",
  trackRules: [
    ...SETUP_RULES,
    { glob: "{vite.config.*,eslint.config.*,postcss.config.*,tailwind.config.*,env.d.ts,src/env.d.ts}", track: "setup" },
    ...DEPLOYMENT_RULES,
    { glob: "**/*.{d.ts,types.ts}", track: "shared" },
  ],
  defaultTrack: "frontend",
  buildOrder: [
    "types",
    "pure helpers (formatting, filtering, sorting)",
    "stores (Pinia): the state and the actions that change it",
    "small components that only display their props and emit events",
    "components that use a store",
    "pages, then the router that maps URLs to them",
    "the root App component and main.ts that mounts it",
  ],
  check: {
    hints: [
      "components and pages: \"ui\", a test in a real browser on the running app (what the page shows, clicking, typing)",
      "stores and helpers: the project's own tests where they cover them",
      "types and code no page shows yet: the project type-checks",
    ],
    fallback: "build",
  },
  // vite build bundles from main.ts, which comes last; each step type-checks .vue files instead.
  stepBuild: "npx vue-tsc --noEmit",
  run: { scripts: ["dev", "start"], portEnv: "PORT", readyPaths: ["/"], port: 5173, portArgs: "-- --port {port} --strictPort" },
  uiMount: "vue",
  lessonHints: [
    "A single-file component has a <script setup> (its logic), a <template> (its HTML) and optional <style>; what the script declares is usable in the template.",
    "defineProps declares what the parent passes in; defineEmits the events the component sends back up (v-on / @ in the parent). Props flow down, events flow up.",
    "ref() holds a reactive value (read and write .value in the script, without .value in the template); computed() derives one that updates by itself.",
    "v-model binds an input to a value both ways; on a component, defineModel() is its side of it.",
    "A Pinia store (defineStore) holds state shared by several components: any component calls useXStore() and gets the same store.",
    "The router maps paths to page components; RouterLink navigates without reloading, RouterView shows the current page, `props: true` passes route params as props.",
  ],
};
