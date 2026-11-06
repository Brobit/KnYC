import { describe, expect, it } from "vitest";
import {
  buildUnits,
  filesAtStep,
  graphSchema,
  profileFor,
  profileForTrack,
  sliceSource,
  splitByRules,
  unitsForTrack,
  type GraphFile,
  type Scan,
} from "../src/index.ts";

// The database track (#98): an Express API over Prisma, shaped like the prisma-library golden repo.

const SCHEMA = `generator client {
  provider = "prisma-client"
}

datasource db {
  provider = "sqlite"
}

model Author {
  id    Int    @id
  books Book[]
}

model Book {
  id       Int    @id
  author   Author @relation(fields: [authorId], references: [id])
  authorId Int
}
`;

const ts = (path: string, symbols: string[], imports: string[] = []): GraphFile => ({
  path,
  language: "typescript",
  loc: 5,
  test: false,
  parseErrors: false,
  imports: imports.map((i) => ({ specifier: `./${i}`, resolved: i, names: [], typeOnly: false, reexport: false })),
  exports: symbols,
  symbols: symbols.map((name, i) => ({ name, kind: "function", exported: true, startLine: i + 1, endLine: i + 1 })),
});

const graph = graphSchema.parse({
  files: [
    {
      path: "prisma/schema.prisma",
      language: "prisma",
      loc: 19,
      test: false,
      parseErrors: false,
      imports: [],
      exports: ["Author", "Book"],
      symbols: [
        { name: "Author", kind: "class", exported: true, startLine: 9, endLine: 12 },
        { name: "Book", kind: "class", exported: true, startLine: 14, endLine: 18 },
      ],
    },
    { path: "prisma/migrations/1_init/migration.sql", language: "sql", loc: 3, test: false, parseErrors: false, imports: [], exports: [], symbols: [] },
    ts("prisma.config.ts", ["default"]),
    ts("src/db.ts", ["createDb"]),
    ts("src/queries/catalog.ts", ["addBook", "booksByAuthor"], ["src/db.ts"]),
    ts("src/app.ts", ["createApp", "health"], ["src/queries/catalog.ts"]),
    { ...ts("src/server.ts", [], ["src/app.ts"]), symbols: [] },
  ],
  edges: [],
  symbolEdges: [
    ["prisma/schema.prisma#Book", "prisma/schema.prisma#Author"],
    ["prisma/migrations/1_init/migration.sql", "prisma/schema.prisma#Book"],
    ["src/queries/catalog.ts#addBook", "prisma/migrations/1_init/migration.sql"],
    ["src/queries/catalog.ts#booksByAuthor", "prisma/migrations/1_init/migration.sql"],
    ["src/app.ts#createApp", "src/queries/catalog.ts#addBook"],
    ["src/app.ts#createApp", "src/queries/catalog.ts#booksByAuthor"],
  ],
  cycles: [],
  layers: [["prisma/schema.prisma", "prisma.config.ts", "src/db.ts"], ["prisma/migrations/1_init/migration.sql"], ["src/queries/catalog.ts"], ["src/app.ts"], ["src/server.ts"]],
  external: {},
  unresolved: [],
});

const scan = {
  frameworks: [
    { profileId: "express", version: "5.3.0", root: "." },
    { profileId: "prisma", version: "7.10.1", root: "." },
  ],
  packages: [{ root: ".", dependencies: {} }],
} as unknown as Scan;

describe("the database track (#98)", () => {
  it("is Prisma's: the schema, migrations, client and queries; the web framework keeps the rest", () => {
    expect(profileForTrack(["express", "prisma"], "database").id).toBe("prisma");
    expect(profileFor(["prisma", "express"]).id).toBe("express");
    const split = splitByRules(scan, graph);
    expect(split.files).toEqual({
      "prisma/schema.prisma": "database",
      "prisma/migrations/1_init/migration.sql": "database",
      "prisma.config.ts": "setup",
      "src/db.ts": "database",
      "src/queries/catalog.ts": "database",
      "src/app.ts": "backend",
      "src/server.ts": "backend",
    });
    expect(split.leftovers).toEqual([]);
  });

  it("holds back the API code that calls queries until they exist; at the end it is the original", async () => {
    const units = unitsForTrack(buildUnits(graph), splitByRules(scan, graph), "database");
    expect([...units.held!.waitsFor.keys()]).toEqual(["src/app.ts#createApp", "src/server.ts"]);
    expect([...units.held!.waitsFor.get("src/server.ts")!].sort()).toEqual(["src/queries/catalog.ts#addBook", "src/queries/catalog.ts#booksByAuthor"]);

    const order = ["prisma/schema.prisma#Author", "prisma/schema.prisma#Book", "src/db.ts#createDb", "prisma/migrations/1_init/migration.sql", "src/queries/catalog.ts#addBook", "src/queries/catalog.ts#booksByAuthor"];
    const stepOf = new Map(order.map((id, i) => [id, i]));
    const read = async (path: string) => (path === "prisma/schema.prisma" ? SCHEMA : path === "src/app.ts" ? "export function createApp() {}\nexport function health() {}\n" : "x\n");

    const setup = await filesAtStep(-1, graph, units, stepOf, read);
    // What uses no query (a health route) is there from the start.
    expect(setup.get("src/app.ts")).toBe("export function health() {}\n");
    expect(setup.get("src/server.ts")).toBeNull();
    expect(setup.get("prisma/schema.prisma")).toBe('generator client {\n  provider = "prisma-client"\n}\n\ndatasource db {\n  provider = "sqlite"\n}\n');

    const oneQuery = await filesAtStep(4, graph, units, stepOf, read);
    expect(oneQuery.get("src/app.ts")).toBe("export function health() {}\n");
    const all = await filesAtStep(5, graph, units, stepOf, read);
    expect(all.get("src/app.ts")).toBe("export function createApp() {}\nexport function health() {}\n");
    expect(all.get("src/server.ts")).toBe("x\n");
  });

  it("leaves out the other side of a relation until its model exists", () => {
    const atoms = buildUnits(graph).byFile.get("prisma/schema.prisma")!.map((id) => buildUnits(graph).byId.get(id)!);
    const file = graph.files[0]!;
    const ctx = { fileExists: () => true, symbolExists: () => undefined };
    expect(sliceSource(SCHEMA, file, atoms, new Set(["prisma/schema.prisma#Author"]), ctx)).toContain("model Author {\n  id    Int    @id\n}");
    expect(sliceSource(SCHEMA, file, atoms, new Set(atoms.map((a) => a.id)), ctx)).toBe(SCHEMA);
  });
});
