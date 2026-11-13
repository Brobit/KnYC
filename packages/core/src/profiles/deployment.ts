// The deployment track (#100, VISION §3: deployment stays local). Not a framework: the same
// profile for any project's Dockerfiles, compose files and CI workflows. Its checks are
// deterministic (pipeline/checks/deployment.ts): the image builds and answers, the services come
// up, the workflow is valid.

import { DEPLOYMENT_RULES } from "./shared-rules.ts";
import type { Profile } from "./types.ts";

export const deployment: Profile = {
  id: "deployment",
  label: "Deployment",
  kind: "deployment",
  trackRules: DEPLOYMENT_RULES,
  defaultTrack: "deployment",
  buildOrder: [
    "a Dockerfile per service, the backend first (the frontend may forward to it)",
    "the compose file that runs them together",
    "the CI workflow that builds and tests on every push",
  ],
  check: {
    hints: [
      "a Dockerfile: the image builds, and the container answers on its health path",
      "a compose file: the services come up (healthy) and their published ports answer",
      "a CI workflow: it's valid, and every npm script it runs exists",
    ],
    fallback: "build",
  },
  lessonHints: [
    "A Dockerfile is a recipe: each instruction is a layer, cached until what it copies changes; copy package.json and install before copying the code, so code changes don't reinstall everything.",
    "A multi-stage build compiles in a first image with the dev dependencies, then copies only the result into a small runtime image.",
    "EXPOSE documents the port the app listens on; HEALTHCHECK lets Docker (and compose's depends_on) know when the app is really ready, not just started.",
    "In compose, services reach each other by their service name (http://api:3000); only the ports under `ports` are published on your machine.",
    "A CI workflow runs on GitHub's machines: `on` says when, each job says where (`runs-on`) and lists its steps, each running a command or using an action.",
  ],
};
