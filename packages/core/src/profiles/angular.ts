// Angular (#95, VISION §6; golden repo angular-notes): standalone components, services injected
// where they're needed, router pages. Checked in a real browser on `ng serve`; until the app has its
// own src/main.ts (it comes last), a check's mount is that file. Each step type-checks its templates
// too with ngc.

import { DEPLOYMENT_RULES, SETUP_RULES } from "./shared-rules.ts";
import type { Profile } from "./types.ts";

export const angular: Profile = {
  id: "angular",
  label: "Angular",
  kind: "frontend",
  trackRules: [
    ...SETUP_RULES,
    { glob: "{angular.json,karma.conf.*,proxy.conf.*,src/environments/**}", track: "setup" },
    ...DEPLOYMENT_RULES,
    { glob: "**/*.{d.ts,types.ts}", track: "shared" },
  ],
  defaultTrack: "frontend",
  buildOrder: [
    "types and pure helpers",
    "services: the state and the operations on it, injectable",
    "small components that only display their inputs and emit outputs",
    "components that compose them, and pages that inject the services",
    "the routes, then the app configuration that provides them",
    "the root component, and main.ts that bootstraps the app",
  ],
  check: {
    hints: [
      "components and pages: \"ui\", a test in a real browser on the running app (what the page shows, clicking, typing)",
      "services and helpers: the project's own tests where they cover them",
      "types and code no page shows yet: the project type-checks",
    ],
    fallback: "build",
  },
  // ng build bundles from main.ts, which comes last; each step compiles the components (templates
  // included) without emitting.
  stepBuild: "npx ngc -p tsconfig.json --noEmit",
  run: { scripts: ["start"], portEnv: "PORT", readyPaths: ["/"], port: 4200, portArgs: "-- --port {port}" },
  uiMount: "angular-main",
  entryFiles: ["src/main.ts"],
  lessonHints: [
    "A standalone component is a class with @Component: a selector (the tag that uses it), a template, and the components it uses in `imports`.",
    "input() declares what the parent passes in ([note]=\"…\"), output() the events it emits ((remove)=\"…\"); model() is both, for two-way binding with [(…)].",
    "Signals hold state: read with note(), change with set() or update(); computed() derives a value that updates by itself, and templates re-render when the signals they read change.",
    "A service (@Injectable({ providedIn: 'root' })) is created once and shared; components get it with inject(NotesService).",
    "The new control flow (@if, @for with track) replaces *ngIf and *ngFor in templates.",
    "Routes map paths to components; provideRouter in the app config turns them on, and withComponentInputBinding passes route params as inputs.",
  ],
};
