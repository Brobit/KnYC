import { joinPath, type Host } from "../host/host.ts";
import type { Graph, Scan } from "../sys/knyc-sys.ts";
import { redact, secretLinesByFile } from "./redact.ts";
import type { ProjectFacts, SourceFile } from "./summaries.ts";

/**
 * The files to summarize: non-test source files of the graph, in layer order (leaves first),
 * with possible secrets redacted.
 */
export async function loadSourceFiles(host: Host, root: string, scan: Scan, graph: Graph): Promise<SourceFile[]> {
  const secrets = secretLinesByFile(scan.secretLines);
  const notForAi = new Set(scan.files.filter((f) => f.notForAi).map((f) => f.path));
  const byPath = new Map(graph.files.map((f) => [f.path, f]));

  const files: SourceFile[] = [];
  for (const [layer, paths] of graph.layers.entries()) {
    for (const path of paths) {
      const node = byPath.get(path);
      if (!node || node.test || notForAi.has(path)) continue;
      const content = await host.readFile(joinPath(root, path));
      files.push({
        path,
        content: redact(content, secrets.get(path) ?? []),
        symbols: node.symbols.map(({ name, kind }) => ({ name, kind })),
        layer,
      });
    }
  }
  return files;
}

/** Non-test source files that no other source file imports, in layer order. */
export function entryPoints(graph: Graph): string[] {
  const tests = new Set(graph.files.filter((f) => f.test).map((f) => f.path));
  const imported = new Set(graph.edges.filter((e) => !tests.has(e.from)).map((e) => e.to));
  return graph.layers.flat().filter((path) => !imported.has(path));
}

export function projectFacts(name: string, scan: Scan, graph: Graph): ProjectFacts {
  return {
    name,
    languages: scan.languages.map((l) => l.id),
    frameworks: scan.frameworks.map((f) => (f.version ? `${f.profileId} ${f.version}` : f.profileId)),
    layers: graph.layers,
    entryPoints: entryPoints(graph),
  };
}
