// Track rules every JavaScript profile shares (#85): setup files, the database, deployment. A
// profile puts its own rules first and these after them.

import type { TrackRule } from "./types.ts";

export const SETUP_RULES: TrackRule[] = [
  { glob: "{package.json,package-lock.json,pnpm-lock.yaml,yarn.lock,pnpm-workspace.yaml}", track: "setup" },
  { glob: "{tsconfig*.json,jsconfig.json,.nvmrc,.node-version,.npmrc.example}", track: "setup" },
  { glob: "{.eslintrc*,eslint.config.*,.prettierrc*,prettier.config.*,.editorconfig,.gitignore}", track: "setup" },
  { glob: "{vitest.config.*,jest.config.*,babel.config.*,.babelrc}", track: "setup" },
];

export const DATABASE_RULES: TrackRule[] = [
  { glob: "**/prisma/**", track: "database" },
  { glob: "**/{migrations,migration,seeds,seeders}/**", track: "database" },
  { glob: "**/*.sql", track: "database" },
  { glob: "{drizzle.config.*,ormconfig.*,knexfile.*}", track: "database" },
];

export const DEPLOYMENT_RULES: TrackRule[] = [
  { glob: "**/{Dockerfile,Dockerfile.*,.dockerignore}", track: "deployment" },
  { glob: "{docker-compose*.yml,docker-compose*.yaml,compose*.yml,compose*.yaml}", track: "deployment" },
  { glob: ".github/**", track: "deployment" },
  { glob: "{.gitlab-ci.yml,Procfile,fly.toml,render.yaml,vercel.json,netlify.toml}", track: "deployment" },
];
