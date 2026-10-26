import { describe, expect, it } from "vitest";
import notesGraph from "./fixtures/graphs/express-notes.json";
import shopGraph from "./fixtures/graphs/express-shop.json";
import { architectureMap, graphSchema, MAP_NODE, moduleLabel, projectTracks, type Graph, type Scan } from "../src/index.ts";

const notes = graphSchema.parse(notesGraph);
const shop = graphSchema.parse(shopGraph);

const scanOf = (graph: Graph, frameworks: Scan["frameworks"] = [{ profileId: "express", version: "4.21.2", root: "." }]): Scan => ({
  root: "/s",
  hash: "blake3:ab",
  languages: [],
  frameworks,
  testRunners: [],
  packages: [],
  commands: [],
  toolchains: [],
  files: [
    ...graph.files.map((f) => ({ path: f.path, bytes: 1000, lines: f.loc })),
    { path: "package.json", bytes: 500, lines: 30 },
    { path: "package-lock.json", bytes: 90_000, lines: 2_400, notForAi: "lockfile" },
  ],
  excluded: [],
  secretLines: [],
});

describe("projectTracks", () => {
  it("offers Backend and Full project for an Express API", () => {
    const { tracks, hasFrontend } = projectTracks(scanOf(shop), shop);
    expect(hasFrontend).toBe(false);
    expect(tracks.map((t) => t.id)).toEqual(["backend", "full"]);
    const [backend, full] = tracks;
    const sources = shop.files.filter((f) => !f.test);
    expect(backend.files).toBe(sources.length);
    expect(backend.lines).toBe(sources.reduce((sum, f) => sum + f.loc, 0));
    // The whole project adds package.json; lockfiles and tests don't count.
    expect(full.files).toBe(sources.length + 1);
    expect(backend.hours).toBeGreaterThanOrEqual(1);
    expect(backend.modules.slice(0, 2)).toEqual(expect.arrayContaining(["shared"]));
  });

  it("offers the tracks the project has code for (#86): a React project's code is its frontend", () => {
    const { tracks, hasFrontend } = projectTracks(scanOf(notes, [{ profileId: "react", version: "19", root: "." }]), notes);
    expect(hasFrontend).toBe(true);
    expect(tracks.map((t) => t.id)).toEqual(["frontend", "full"]);
  });

  it("offers a card per track of a full-stack project", () => {
    const scan = scanOf(notes, [
      { profileId: "react", version: "19", root: "web" },
      { profileId: "express", version: "4", root: "." },
    ]);
    const graph = { ...notes, files: [...notes.files, { ...notes.files[0]!, path: "web/src/App.tsx", test: false }] };
    const { tracks } = projectTracks(scan, graph);
    expect(tracks.map((t) => t.id)).toEqual(["frontend", "backend", "full"]);
    expect(tracks[0]).toMatchObject({ id: "frontend", files: 1 });
  });

  it("names folders the short way", () => {
    expect(moduleLabel("src/users")).toBe("users");
    expect(moduleLabel("src")).toBe("app");
    expect(moduleLabel(".")).toBe("app");
    expect(moduleLabel("lib/auth/jwt")).toBe("lib/auth/jwt");
  });
});

describe("architectureMap", () => {
  it("shows files for a small project, entry points on top, runtime imports only", () => {
    const map = architectureMap(notes);
    expect(map.level).toBe("file");
    const sources = notes.files.filter((f) => !f.test).map((f) => f.path);
    expect(map.nodes.map((n) => n.id).sort()).toEqual([...sources].sort());
    // server.ts is the last layer: alone in the top row.
    const top = map.nodes.filter((n) => n.y === 0).map((n) => n.id);
    expect(top).toEqual(["src/server.ts"]);
    const runtime = notes.edges.filter((e) => !e.typeOnly && sources.includes(e.from) && sources.includes(e.to));
    expect(map.edges).toHaveLength(runtime.length);
  });

  it("groups a bigger project by folder, without self-loops, and lays rows out without overlaps", () => {
    const map = architectureMap(shop);
    expect(map.level).toBe("module");
    expect(map.nodes.map((n) => n.label).sort()).toEqual(["app", "auth", "cart", "orders", "payments", "products", "shared", "users"]);
    expect(map.edges.every((e) => e.from !== e.to)).toBe(true);
    const byRow = new Map<number, number[]>();
    for (const n of map.nodes) byRow.set(n.y, [...(byRow.get(n.y) ?? []), n.x]);
    for (const xs of byRow.values()) {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(MAP_NODE.width);
    }
    expect(Math.max(...map.nodes.map((n) => n.x + MAP_NODE.width))).toBeLessThanOrEqual(map.width + 0.001);
    expect(Math.max(...map.nodes.map((n) => n.y + MAP_NODE.height))).toBe(map.height);
  });

  it("puts each file's role under it once summaries exist", () => {
    const summaries = {
      version: 1,
      files: [{ path: "src/server.ts", role: "starts the HTTP server on the configured port", summary: "s", keySymbols: [] }],
      modules: [],
      project: { name: "n", purpose: "p", architecture: "a", entryPoints: [], keyConcepts: [] },
    };
    const server = architectureMap(notes, summaries).nodes.find((n) => n.id === "src/server.ts");
    expect(server?.sub).toBe("starts the HTTP server on…");
  });
});
