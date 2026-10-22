// What the import screen needs from the system (#59): pick the source (which lets the pipeline read
// it), scan and graph it without AI, and suggest a workspace folder. A plain browser (`pnpm dev`)
// gets a sample project.
import { join, homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { graphProject, scanProject, type Graph, type Scan } from "@knyc/core";
import { pickSourceFolder, TauriHost } from "@/lib/pipeline-host";
import { isTauri } from "@/lib/settings";

export interface QuickScan {
  scan: Scan;
  graph: Graph;
}

export interface ImportBackend {
  /** The folder dialog for the project; it becomes readable for the analysis. Null when cancelled. */
  pickSource(): Promise<string | null>;
  /** Static scan and code graph of the source: seconds, no AI. */
  quickScan(source: string): Promise<QuickScan>;
  /** `~/KnYC/<name>` on this machine. */
  defaultWorkspace(name: string): Promise<string>;
  /** The folder dialog for the workspace (only the path comes back). */
  pickWorkspace(): Promise<string | null>;
}

export function createTauriImportBackend(): ImportBackend {
  const host = new TauriHost();
  return {
    pickSource: pickSourceFolder,
    async quickScan(source) {
      const [scan, graph] = await Promise.all([scanProject(host, source, { toolchains: false }), graphProject(host, source)]);
      return { scan, graph };
    },
    defaultWorkspace: async (name) => join(await homeDir(), "KnYC", name),
    pickWorkspace: () => invoke<string | null>("pipeline_choose_folder"),
  };
}

const SAMPLE_FILES = [
  { path: "src/config.ts", lines: 18, bytes: 520 },
  { path: "src/errors.ts", lines: 24, bytes: 690 },
  { path: "src/notes/note.ts", lines: 12, bytes: 300 },
  { path: "src/notes/notes.store.ts", lines: 46, bytes: 1300 },
  { path: "src/notes/notes.validation.ts", lines: 30, bytes: 880 },
  { path: "src/notes/notes.routes.ts", lines: 58, bytes: 1750 },
  { path: "src/app.ts", lines: 26, bytes: 760 },
  { path: "src/server.ts", lines: 9, bytes: 210 },
  { path: "test/notes.test.ts", lines: 80, bytes: 2600 },
];

/** A small Express project, like the golden repo express-notes. */
export function createFakeImportBackend(): ImportBackend {
  return {
    pickSource: async () => "/home/you/code/express-notes",
    async quickScan(source) {
      const scan = {
        root: source,
        hash: "blake3:0123456789abcdef0123456789abcdef",
        languages: [{ id: "typescript", files: 9, loc: 303 }],
        frameworks: [{ profileId: "express", version: "^4.21.2", root: "." }],
        testRunners: [{ runner: "vitest", root: "." }],
        packages: [],
        commands: [{ root: ".", install: "npm ci", build: "npm run build", test: "npm run test", run: "npm run start" }],
        toolchains: [],
        files: [
          ...SAMPLE_FILES,
          { path: "package.json", lines: 30, bytes: 800 },
          { path: "package-lock.json", lines: 2400, bytes: 90_000, notForAi: "lockfile" },
          { path: "docs/diagram.png", lines: 0, bytes: 40_000, notForAi: "binary" },
        ],
        excluded: [
          { path: ".env", reason: "secret" },
          { path: "node_modules/", reason: "ignored" },
          { path: "dist/", reason: "ignored" },
        ],
        secretLines: [],
      } as Scan;
      const node = (path: string) => ({
        path,
        language: "typescript",
        loc: 20,
        test: path.startsWith("test/"),
        parseErrors: false,
        imports: [],
        exports: ["x"],
        symbols: [{ name: "x", kind: "function", exported: true, startLine: 1, endLine: 5 }],
      });
      const imports: [string, string][] = [
        ["src/server.ts", "src/app.ts"],
        ["src/app.ts", "src/notes/notes.routes.ts"],
        ["src/app.ts", "src/errors.ts"],
        ["src/notes/notes.routes.ts", "src/notes/notes.store.ts"],
        ["src/notes/notes.routes.ts", "src/notes/notes.validation.ts"],
        ["src/notes/notes.store.ts", "src/notes/note.ts"],
        ["src/notes/notes.validation.ts", "src/errors.ts"],
        ["src/server.ts", "src/config.ts"],
      ];
      const graph = {
        files: SAMPLE_FILES.map((f) => node(f.path)),
        edges: imports.map(([from, to]) => ({ from, to, typeOnly: false })),
        symbolEdges: [],
        cycles: [],
        layers: [SAMPLE_FILES.slice(0, 3).map((f) => f.path), SAMPLE_FILES.slice(3, 6).map((f) => f.path), SAMPLE_FILES.slice(6).map((f) => f.path)],
        external: {},
        unresolved: [],
      } as Graph;
      return { scan, graph };
    },
    defaultWorkspace: async (name) => `/home/you/KnYC/${name}`,
    pickWorkspace: async () => "/home/you/learning/express-notes",
  };
}

export const importBackend: ImportBackend = isTauri() || !import.meta.env.DEV ? createTauriImportBackend() : createFakeImportBackend();
