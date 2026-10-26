// The fallback for projects no profile knows (#85): the code graph and the AI do the work, steps
// are checked with unit tests where something is callable, else by the build.

import { DATABASE_RULES, DEPLOYMENT_RULES, SETUP_RULES } from "./shared-rules.ts";
import type { Profile } from "./types.ts";

export const generic: Profile = {
  id: "generic",
  label: "Project",
  kind: "generic",
  trackRules: [...SETUP_RULES, ...DATABASE_RULES, ...DEPLOYMENT_RULES, { glob: "**/{types,shared,common}/**", track: "shared" }],
  defaultTrack: "backend",
  buildOrder: [
    "configuration and shared types",
    "errors and small helpers",
    "data models and storage",
    "the core logic, one feature at a time",
    "the interfaces to the outside (HTTP, command line, UI)",
    "the entry point that starts the program",
  ],
  check: {
    hints: ["functions and classes: unit tests calling them directly", "anything else: the project builds"],
    fallback: "build",
  },
  lessonHints: [],
};
