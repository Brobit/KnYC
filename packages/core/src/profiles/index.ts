// Framework profiles (VISION §6): what a framework's natural build order looks like and how its
// steps are best checked. M1 only needs Express; the rest come in M4.

export interface Profile {
  id: string;
  label: string;
  /** Natural order to rebuild a project, given to the planner as guidance. */
  buildOrder: string[];
  /** How steps are usually checked in this framework. */
  checkHints: string[];
}

export const profiles: Record<string, Profile> = {
  express: {
    id: "express",
    label: "Express",
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
    checkHints: [
      "routes and the app: HTTP requests against the running app (status codes, JSON bodies)",
      "stores, services, validation: unit tests calling the functions directly",
      "pure types and interfaces: the project builds (tsc)",
    ],
  },
};

export function profileFor(frameworks: string[]): Profile | undefined {
  return frameworks.map((f) => profiles[f.split(" ")[0]!]).find(Boolean);
}
