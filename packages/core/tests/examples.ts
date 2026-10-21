// Valid example documents, modeled on the express-notes golden repo.

const at = "2026-10-21T10:00:00.000Z";
const claude = { providerId: "claude-cli", model: "sonnet" };

export const settingsExample = {
  schemaVersion: 1,
  providers: [{ id: "claude-cli", type: "claude-cli", label: "Claude Code" }],
  roles: { summaries: claude, planning: claude, lessons: claude },
};

export const projectExample = {
  schemaVersion: 1,
  id: "express-notes",
  name: "express-notes",
  source: { path: "/code/express-notes", hash: "sha256:abc" },
  createdAt: at,
  languages: [{ id: "typescript", loc: 203 }],
  frameworks: [{ profileId: "express", version: "5.3.0", root: "." }],
  toolchains: [{ id: "node", required: ">=22", found: "22.23.2" }],
  commands: [{ root: ".", install: "npm ci", build: "npm run build", test: "npm test" }],
  tracks: [
    {
      id: "backend",
      label: "Backend",
      units: ["src/app.ts", "src/notes/notes.store.ts#NotesStore"],
      loc: 203,
      contracts: [{ kind: "http", method: "GET", path: "/notes" }],
    },
  ],
  excluded: [{ path: ".env", reason: "secret" }],
};

export const pathExample = {
  schemaVersion: 1,
  id: "backend-overview",
  trackId: "backend",
  size: "overview",
  setupAsStep: false,
  generatedWith: { planning: claude, at },
  status: "ready",
  milestones: [
    { id: "m1", title: "Store", summary: "Keep notes in memory", stepIds: ["s01"] },
    { id: "m2", title: "API", summary: "Expose notes over HTTP", stepIds: ["s02"] },
  ],
  steps: [
    {
      id: "s01",
      index: 0,
      title: "Notes store",
      goal: "Create, list, update and delete notes in memory.",
      introduces: [{ unit: "src/notes/notes.store.ts#NotesStore", kind: "class", change: "add" }],
      estimatedMinutes: 20,
    },
    {
      id: "s02",
      index: 1,
      title: "Notes routes",
      goal: "Expose the store as a REST API.",
      introduces: [{ unit: "src/notes/notes.routes.ts", kind: "file", change: "add" }],
      dependsOn: ["s01"],
      checkIds: ["chk-s02-1"],
      estimatedMinutes: 30,
    },
  ],
};

export const checkExample = {
  schemaVersion: 1,
  id: "chk-s02-1",
  stepId: "s02",
  label: "POST /notes returns 201",
  origin: "generated",
  spec: {
    kind: "http",
    server: { start: "npm start", root: ".", port: 3000, readyPath: "/health" },
    requests: [{ method: "POST", path: "/notes", body: { title: "A" }, expect: { status: 201 } }],
  },
  validation: { failsOnPrevious: true, passesOnReference: true, at },
};

export const lessonExample = {
  schemaVersion: 1,
  stepId: "s02",
  generatedWith: claude,
  at,
  explanation: "An Express **router** groups related routes.",
  hints: [{ level: 1, text: "Start with GET /." }],
};

export const progressExample = {
  schemaVersion: 1,
  activePathId: "backend-overview",
  paths: {
    "backend-overview": {
      currentStepId: "s02",
      startedAt: at,
      steps: {
        s01: { status: "passed", passedAt: at, attempts: 2, hintsUsed: [1], snapshot: "abc123" },
        s02: { status: "in-progress", startedAt: at },
      },
    },
  },
};

export const clone = <T>(value: T): T => structuredClone(value);
