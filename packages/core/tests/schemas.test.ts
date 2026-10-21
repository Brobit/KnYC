import { describe, expect, it } from "vitest";
import {
  check,
  isValidated,
  learningPath,
  lesson,
  progress,
  project,
  settings,
  unitId,
  type Check,
} from "../src/index.ts";
import {
  checkExample,
  clone,
  lessonExample,
  pathExample,
  progressExample,
  projectExample,
  settingsExample,
} from "./examples.ts";

describe("valid examples parse", () => {
  it.each([
    ["settings", settings, settingsExample],
    ["project", project, projectExample],
    ["path", learningPath, pathExample],
    ["check", check, checkExample],
    ["lesson", lesson, lessonExample],
    ["progress", progress, progressExample],
  ] as const)("%s", (_name, schema, example) => {
    expect(schema.safeParse(example).success).toBe(true);
  });

  it("fills defaults", () => {
    const parsed = settings.parse(settingsExample);
    expect(parsed.theme).toEqual({ name: "focus", mode: "system" });
    expect(parsed.confirmCostEstimate).toBe(true);
    expect(progress.parse(progressExample).paths["backend-overview"]?.steps.s02?.attempts).toBe(0);
  });
});

describe("unitId", () => {
  it.each(["src/app.ts", "src/users.service.ts#UsersService", "src/a.ts#UsersService.create", "Dockerfile"])(
    "accepts %s",
    (value) => expect(unitId.safeParse(value).success).toBe(true),
  );
  it.each(["src/app.ts#", "src/app.ts#1bad", "has space.ts", "src/a.ts#A#B"])("rejects %s", (value) =>
    expect(unitId.safeParse(value).success).toBe(false),
  );
});

describe("learningPath integrity", () => {
  const issues = (value: unknown) =>
    learningPath.safeParse(value).error?.issues.map((i) => i.message) ?? [];

  it("rejects duplicate step ids", () => {
    const p = clone(pathExample);
    p.steps[1]!.id = "s01";
    p.steps[1]!.dependsOn = [];
    expect(issues(p)).toContain("duplicate step id s01");
  });

  it("rejects indexes that don't match the order", () => {
    const p = clone(pathExample);
    p.steps[1]!.index = 5;
    expect(issues(p)).toContain("index should be 1");
  });

  it("rejects dependencies on later or unknown steps", () => {
    const p = clone(pathExample);
    p.steps[1]!.dependsOn = ["s09"];
    expect(issues(p)).toContain("s09 is not an earlier step");
  });

  it("requires every step in exactly one milestone", () => {
    const p = clone(pathExample);
    p.milestones[1]!.stepIds = ["s01"];
    expect(issues(p)).toContain("every step must belong to exactly one milestone");
  });

  it("requires each step to introduce something", () => {
    const p = clone(pathExample);
    p.steps[0]!.introduces = [];
    expect(learningPath.safeParse(p).success).toBe(false);
  });
});

describe("check", () => {
  it("rejects an unknown spec kind and a command check with no expectation", () => {
    expect(check.safeParse({ ...checkExample, spec: { kind: "magic" } }).success).toBe(false);
    const command = { ...checkExample, spec: { kind: "command", command: "npm run build", expect: {} } };
    expect(check.safeParse(command).success).toBe(false);
  });

  it("is validated only when it fails before and passes after", () => {
    const c = check.parse(checkExample) as Check;
    expect(isValidated(c)).toBe(true);
    expect(isValidated({ ...c, validation: { ...c.validation!, failsOnPrevious: false } })).toBe(false);
    expect(isValidated({ ...c, validation: undefined })).toBe(false);
  });
});

describe("other rules", () => {
  it("rejects bad hint levels, dates and ids", () => {
    expect(lesson.safeParse({ ...lessonExample, hints: [{ level: 4, text: "x" }] }).success).toBe(false);
    expect(lesson.safeParse({ ...lessonExample, at: "yesterday" }).success).toBe(false);
    expect(project.safeParse({ ...projectExample, excluded: [{ path: ".env", reason: "secret!" }] }).success).toBe(false);
    expect(check.safeParse({ ...checkExample, id: "Check 1" }).success).toBe(false);
  });

  it("never stores API keys in settings", () => {
    const withKey = clone(settingsExample) as typeof settingsExample & { providers: Record<string, unknown>[] };
    withKey.providers[0]!.apiKey = "sk-secret";
    expect(settings.parse(withKey).providers[0]).not.toHaveProperty("apiKey");
  });
});
