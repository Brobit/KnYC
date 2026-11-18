import { describe, expect, it } from "vitest";
import { buildUnits, sliceSource, type Graph, type GraphFile } from "../src/index.ts";

const source = `from fastapi import APIRouter, Depends

from ..models import Note, NotePatch
from . import store as notes_store
from .. import deps
import app.config


# Notes in memory.
class NotesStore:
    def __init__(self):
        self.notes = []

    def add(self, note: Note) -> Note:
        self.notes.append(note)
        return note


def patch(p: NotePatch) -> None:
    pass
`;

const file = {
  path: "app/routes/notes.py",
  language: "python",
  loc: 20,
  test: false,
  parseErrors: false,
  imports: [
    { specifier: "fastapi", package: "fastapi", names: ["APIRouter", "Depends"], typeOnly: false, reexport: false },
    { specifier: "..models", resolved: "app/models.py", names: ["Note", "NotePatch"], typeOnly: false, reexport: false },
    { specifier: ".store", resolved: "app/routes/store.py", names: ["store"], typeOnly: false, reexport: false, module: true },
    { specifier: "..deps", resolved: "app/deps.py", names: ["deps"], typeOnly: false, reexport: false, module: true },
    { specifier: "app.config", resolved: "app/config.py", names: ["app"], typeOnly: false, reexport: false, module: true },
  ],
  exports: ["NotesStore", "patch"],
  symbols: [
    { name: "NotesStore", kind: "class", exported: true, startLine: 10, endLine: 16 },
    { name: "NotesStore.__init__", kind: "method", exported: true, startLine: 11, endLine: 12 },
    { name: "NotesStore.add", kind: "method", exported: true, startLine: 14, endLine: 16 },
    { name: "patch", kind: "function", exported: true, startLine: 19, endLine: 20 },
  ],
} as unknown as GraphFile;

describe("Python (#126)", () => {
  const graph = { files: [file], edges: [], symbolEdges: [], cycles: [], layers: [[file.path]], external: {}, unresolved: [] } as unknown as Graph;
  const units = buildUnits(graph);

  it("keeps __init__ with its class, like a constructor", () => {
    expect(units.byFile.get(file.path)).toEqual(["app/routes/notes.py#NotesStore", "app/routes/notes.py#NotesStore.add", "app/routes/notes.py#patch"]);
  });

  it("slices a module: names and modules not there yet go, an empty class gets a body", () => {
    const exists = new Set(["app/models.py", "app/routes/notes.py", "app/config.py"]);
    const sliced = sliceSource(source, file, units.atoms, new Set(["app/routes/notes.py#NotesStore"]), {
      fileExists: (p) => exists.has(p),
      symbolExists: (p, name) => (p === "app/models.py" ? name === "Note" : undefined),
    });
    expect(sliced).toBe(`from fastapi import APIRouter, Depends

from ..models import Note
import app.config


# Notes in memory.
class NotesStore:
    def __init__(self):
        self.notes = []
`);
    const bare = sliceSource("class A:\n    def go(self):\n        pass\n\n\nx = A()\n", { ...file, imports: [], symbols: [{ name: "A", kind: "class", exported: true, startLine: 1, endLine: 3 }, { name: "A.go", kind: "method", exported: true, startLine: 2, endLine: 3 }] } as unknown as GraphFile, [
      { id: "f#A", file: "f", kind: "class", exported: true, lines: 3, startLine: 1, endLine: 3 },
      { id: "f#A.go", file: "f", kind: "method", parent: "f#A", exported: true, lines: 2, startLine: 2, endLine: 3 },
    ], new Set(["f#A"]), { fileExists: () => true, symbolExists: () => undefined });
    expect(bare).toBe("class A:\n    pass\n\n\nx = A()\n");
  });
});
