// NestJS (#96, VISION §6: bootstrap → module → controller → service → DB → guards; golden repo
// nest-tasks).

import { DATABASE_RULES, DEPLOYMENT_RULES, SETUP_RULES } from "./shared-rules.ts";
import type { Profile } from "./types.ts";

export const nestjs: Profile = {
  id: "nestjs",
  label: "NestJS",
  kind: "backend",
  trackRules: [
    ...SETUP_RULES,
    { glob: "nest-cli.json", track: "setup" },
    ...DATABASE_RULES,
    ...DEPLOYMENT_RULES,
    { glob: "**/{types,shared,common}/**", track: "shared" },
    { glob: "**/*.{d.ts,types.ts}", track: "shared" },
  ],
  defaultTrack: "backend",
  buildOrder: [
    "configuration and its provider (an injection token or a config module)",
    "the bootstrap: main.ts and an empty root module, so the app starts",
    "a simple controller (health) in the root module",
    "the entities and DTOs a feature works with",
    "the repository that stores them (in memory or through the database)",
    "the service with the business rules, injected with the repository",
    "the feature's controller, route by route, and its module",
    "pipes that validate input",
    "guards that protect routes",
  ],
  check: {
    hints: [
      "controllers and modules: HTTP requests against the running app (status codes, JSON bodies)",
      "services, repositories, pipes and guards: unit tests calling them directly, or through Test.createTestingModule when they inject each other",
      "entities, DTOs and interfaces: the project builds (tsc)",
    ],
    fallback: "unit-test",
  },
  run: { scripts: ["start", "start:prod"], portEnv: "PORT", readyPaths: ["/health", "/"] },
  lessonHints: [
    "A NestJS app is a tree of modules: each @Module lists its controllers, the providers it creates, the modules it imports and the providers it exports.",
    "Providers are classes marked @Injectable(); Nest creates them once per module and passes them to constructors that ask for them by type (dependency injection).",
    "A value that isn't a class (configuration, a connection) is provided under a token ({ provide: TOKEN, useFactory }) and injected with @Inject(TOKEN).",
    "Controllers map routes with decorators (@Get(':id'), @Post()) and read the request with parameter decorators (@Param, @Body, @Query).",
    "Pipes transform and validate input before the handler runs (ParseIntPipe turns ':id' into a number or answers 400); guards decide whether the request may run at all (401/403).",
    "Throwing an HttpException (NotFoundException, BadRequestException…) in a service or a handler becomes the matching HTTP status with a JSON body.",
    "With emitDecoratorMetadata, the constructor parameter types are what Nest injects: a type-only import of a class there breaks injection.",
  ],
};
