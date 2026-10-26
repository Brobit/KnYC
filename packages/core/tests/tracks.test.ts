import { describe, expect, it } from "vitest";
import {
  AiClient,
  buildUnits,
  classifyLeftovers,
  extractContracts,
  filesAtStep,
  graphSchema,
  leftoverPrompt,
  splitByRules,
  tracksWithCode,
  unitsForTrack,
  type AiProvider,
  type Graph,
  type GraphFile,
  type Scan,
  type Summaries,
} from "../src/index.ts";

/** A source file with one exported function, importing `uses`. */
function file(path: string, name: string, uses: string[] = []): GraphFile {
  return {
    path,
    language: "typescript",
    loc: 5,
    test: false,
    parseErrors: false,
    imports: uses.map((u) => ({ specifier: `./${u}`, resolved: u, names: [], typeOnly: false, reexport: false })),
    exports: [name],
    symbols: [{ name, kind: "function", exported: true, startLine: 1, endLine: 5 }],
  };
}

/**
 * A full-stack project: a React web app in `web/`, an Express API in `api/`, a seed script at the
 * root that neither package holds.
 */
const graph: Graph = graphSchema.parse({
  files: [
    file("api/src/notes.store.ts", "createStore"),
    file("api/src/app.ts", "createApp", ["api/src/notes.store.ts"]),
    file("api/src/types/note.ts", "toNote"),
    file("web/src/api.ts", "fetchNotes"),
    file("web/src/App.tsx", "App", ["web/src/api.ts"]),
    file("scripts/seed.ts", "seed"),
  ],
  edges: [],
  symbolEdges: [
    ["api/src/app.ts#createApp", "api/src/notes.store.ts#createStore"],
    ["web/src/App.tsx#App", "web/src/api.ts#fetchNotes"],
  ],
  cycles: [],
  layers: [["api/src/notes.store.ts", "api/src/types/note.ts", "web/src/api.ts", "scripts/seed.ts"], ["api/src/app.ts", "web/src/App.tsx"]],
  external: {},
  unresolved: [],
});

const scan = {
  frameworks: [
    { profileId: "react", version: "19", root: "web" },
    { profileId: "express", version: "4", root: "api" },
  ],
  files: [],
} as unknown as Scan;

describe("the track split (#86)", () => {
  it("places each file by its package's profile; files no package holds are left to the AI", () => {
    const split = splitByRules(scan, graph);
    expect(split.files).toEqual({
      "api/src/notes.store.ts": "backend",
      "api/src/app.ts": "backend",
      "api/src/types/note.ts": "shared",
      "web/src/api.ts": "frontend",
      "web/src/App.tsx": "frontend",
      "scripts/seed.ts": "backend",
    });
    expect(split.leftovers).toEqual(["scripts/seed.ts"]);
    expect(tracksWithCode(split)).toEqual(["frontend", "backend"]);
  });

  it("keeps a single-track project's shared folder in that track", () => {
    const api = { frameworks: [{ profileId: "express", root: "." }] } as unknown as Scan;
    const split = splitByRules(api, { ...graph, files: graph.files.filter((f) => f.path.startsWith("api/")) });
    expect(split.files["api/src/types/note.ts"]).toBe("backend");
    expect(split.leftovers).toEqual([]);
  });

  it("asks the AI only about the leftovers, and keeps the default for what it skips", async () => {
    const prompts: string[] = [];
    const provider: AiProvider = {
      id: "claude-cli",
      async complete(request) {
        prompts.push(request.prompt);
        return { json: { files: [{ path: "scripts/seed.ts", track: "database" }, { path: "web/src/App.tsx", track: "backend" }] }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: null, durationMs: 1 };
      },
    };
    const role = { providerId: "claude-cli", model: "haiku" };
    const client = new AiClient({ providers: [provider], roles: { summaries: role, planning: role, lessons: role } });
    const summaries = { project: { name: "notes", purpose: "Notes app.", architecture: "Web + API." }, files: [{ path: "scripts/seed.ts", role: "fills the database" }], modules: [] } as unknown as Summaries;
    const split = await classifyLeftovers(client, splitByRules(scan, graph), summaries);
    expect(split.files["scripts/seed.ts"]).toBe("database");
    // A file that wasn't a leftover keeps its place, whatever the answer says.
    expect(split.files["web/src/App.tsx"]).toBe("frontend");
    expect(prompts[0]).toContain("- scripts/seed.ts: fills the database");
    expect(leftoverPrompt(splitByRules(scan, graph), summaries)).toContain("- web/src/App.tsx: frontend");
  });

  it("reads the contracts between tracks from the code", () => {
    const split = splitByRules(scan, graph);
    const contracts = extractContracts(
      new Map([
        ["api/src/app.ts", `app.get("/health", ok);\nrouter.post('/notes', create);\nconst port = process.env.PORT;\nconst db = process.env["DATABASE_URL"];`],
        ["web/src/api.ts", "const base = import.meta.env.VITE_API_URL;"],
        ["prisma/schema.prisma", "model Note {\n  id    Int    @id\n  title String\n}\n"],
        ["db/init.sql", "CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT, PRIMARY KEY (id));"],
      ]),
      split,
    );
    expect(contracts).toEqual([
      { track: "backend", contract: { kind: "http", method: "GET", path: "/health" } },
      { track: "backend", contract: { kind: "http", method: "POST", path: "/notes" } },
      { track: "backend", contract: { kind: "env", name: "PORT" } },
      { track: "backend", contract: { kind: "env", name: "DATABASE_URL" } },
      { track: "frontend", contract: { kind: "env", name: "VITE_API_URL" } },
      { track: "database", contract: { kind: "db-table", name: "Note", columns: ["id", "title"] } },
      { track: "database", contract: { kind: "db-table", name: "tags", columns: ["id", "name"] } },
    ]);
  });

  it("teaches the frontend over the frontend only, with the original backend in place (Done when)", async () => {
    const split = splitByRules(scan, graph);
    const units = unitsForTrack(buildUnits(graph), split, "frontend");
    expect(units.atoms.map((a) => a.id)).toEqual(["web/src/api.ts#fetchNotes", "web/src/App.tsx#App"]);
    expect(unitsForTrack(buildUnits(graph), split, "full").atoms).toHaveLength(6);

    // R₀ of the frontend path: its files don't exist yet; the backend's aren't touched (original).
    const stepOf = new Map([
      ["web/src/api.ts#fetchNotes", 0],
      ["web/src/App.tsx#App", 1],
    ]);
    const r0 = await filesAtStep(-1, graph, units, stepOf, async (path) => `// original ${path}\n`);
    expect([...r0.keys()].sort()).toEqual(["web/src/App.tsx", "web/src/api.ts"]);
    expect([...r0.values()]).toEqual([null, null]);
  });
});
