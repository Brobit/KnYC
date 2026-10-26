// The project overview (#60, design/04 §5): the tracks a learner can pick and the architecture map,
// from the code graph (and the summaries when they are ready). The tracks offered are the ones the
// project has code for (#86, the track split), plus the full project.

import { isFrontendFramework } from "../profiles/index.ts";
import type { TrackId } from "../schemas/common.ts";
import type { Graph, Scan } from "../sys/knyc-sys.ts";
import { behaviorCount, stepRange } from "./plan.ts";
import { moduleOf, type Summaries } from "./summaries.ts";
import { splitByRules, tracksWithCode, unitsForTrack, type TrackSplit } from "./tracks.ts";
import { buildUnits, type Units } from "./units.ts";
import type { PathSize } from "../schemas/learning-path.ts";

/** What a step takes a learner, for the "~6 h standard" on track cards (M1's golden repos). */
export const LEARNER_MINUTES_PER_STEP = 25;

export interface TrackSummary {
  id: TrackId;
  files: number;
  lines: number;
  /** Learner time at the standard size. */
  hours: number;
  /** Folders of the track's code, biggest first ("users", "auth"…). */
  modules: string[];
}

export interface ProjectTracks {
  tracks: TrackSummary[];
  hasFrontend: boolean;
}

export interface PathEstimate {
  /** The step range the planner is asked for (plan.ts). */
  steps: { min: number; max: number };
  /** Learner time, from the middle of the range. */
  hours: number;
}

/** Steps and learner time of a path at one size (design/04 §6). */
export function pathEstimate(units: Units, size: PathSize): PathEstimate {
  const steps = stepRange(size, behaviorCount(units));
  return { steps, hours: Math.max(1, Math.round((((steps.min + steps.max) / 2) * LEARNER_MINUTES_PER_STEP) / 60)) };
}

/** The short name of a folder: "src/users" → "users", "src" or "." → "app". */
export function moduleLabel(module: string): string {
  const parts = module.split("/").filter((p) => p && p !== "." && p !== "src");
  return parts.length > 0 ? parts.join("/") : "app";
}

/** Folders of some files, biggest first ("users", "auth"…). */
function modulesOf(files: Graph["files"]): string[] {
  const byModule = new Map<string, number>();
  for (const file of files) byModule.set(moduleOf(file.path), (byModule.get(moduleOf(file.path)) ?? 0) + 1);
  return [...byModule.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => moduleLabel(m));
}

/**
 * A card per track the project has code for, then the full project. `split`: the saved track
 * split once a path was prepared (the AI placed the leftovers); else the profiles' rules alone.
 */
export function projectTracks(scan: Scan, graph: Graph, split: TrackSplit = splitByRules(scan, graph)): ProjectTracks {
  const hasFrontend = scan.frameworks.some((f) => isFrontendFramework(f.profileId));
  const source = graph.files.filter((f) => !f.test);
  const units = buildUnits(graph);
  const tests = new Set(graph.files.filter((f) => f.test).map((f) => f.path));
  // The whole project: its source plus the files that come with it (config, package.json…).
  const whole = scan.files.filter((f) => !f.notForAi && !tests.has(f.path));

  const tracks: TrackSummary[] = [];
  for (const track of tracksWithCode(split)) {
    const files = source.filter((f) => split.files[f.path] === track);
    if (files.length === 0) continue;
    const { hours } = pathEstimate(unitsForTrack(units, split, track), "standard");
    tracks.push({ id: track, files: files.length, lines: files.reduce((sum, f) => sum + f.loc, 0), hours, modules: modulesOf(files) });
  }
  tracks.push({
    id: "full",
    files: whole.length,
    lines: whole.reduce((sum, f) => sum + f.lines, 0),
    hours: pathEstimate(units, "standard").hours,
    modules: modulesOf(source),
  });
  return { tracks, hasFrontend };
}

export interface MapNode {
  id: string;
  label: string;
  /** A few words under the label: the summary's role, or the size. */
  sub: string;
  x: number;
  y: number;
}

export interface ArchitectureMap {
  /** "file" for small projects, "module" (folders) otherwise. */
  level: "file" | "module";
  nodes: MapNode[];
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

export const MAP_NODE = { width: 156, height: 50, gapX: 24, gapY: 56 };
/** Up to this many source files the map shows files; above, folders. */
const FILE_LEVEL_MAX = 16;

const shorten = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Boxes for files or folders, laid out by layer: what the rest builds on at the bottom, entry
 * points at the top. Lines are runtime imports (type-only imports aren't drawn).
 */
export function architectureMap(graph: Graph, summaries?: Summaries): ArchitectureMap {
  const source = graph.files.filter((f) => !f.test);
  const level = source.length <= FILE_LEVEL_MAX ? "file" : "module";
  const nodeOf = (path: string) => (level === "file" ? path : moduleOf(path));
  const sourcePaths = new Set(source.map((f) => f.path));

  // A node's layer: the highest of its files', so a folder sits above what it imports.
  const layerOf = new Map<string, number>();
  graph.layers.forEach((paths, layer) => {
    for (const path of paths) {
      if (!sourcePaths.has(path)) continue;
      const id = nodeOf(path);
      layerOf.set(id, Math.max(layerOf.get(id) ?? 0, layer));
    }
  });

  const edgeKeys = new Set<string>();
  const edges: { from: string; to: string }[] = [];
  for (const edge of graph.edges) {
    if (edge.typeOnly || !sourcePaths.has(edge.from) || !sourcePaths.has(edge.to)) continue;
    const from = nodeOf(edge.from);
    const to = nodeOf(edge.to);
    const key = `${from}\u0000${to}`;
    if (from === to || edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ from, to });
  }

  const roles = new Map(summaries?.files.map((f) => [f.path, f.role]) ?? []);
  const counts = new Map<string, number>();
  for (const file of source) counts.set(nodeOf(file.path), (counts.get(nodeOf(file.path)) ?? 0) + 1);
  const subOf = (id: string) => {
    if (level === "file") return shorten(roles.get(id) ?? "", 26);
    const count = counts.get(id) ?? 0;
    return `${count} file${count === 1 ? "" : "s"}`;
  };
  const labelOf = (id: string) => (level === "file" ? id.split("/").pop()! : moduleLabel(id));

  // Rows from the top: highest layer first, empty layers skipped.
  const layers = [...new Set(layerOf.values())].sort((a, b) => b - a);
  const rows = layers.map((layer) =>
    [...layerOf.entries()]
      .filter(([, l]) => l === layer)
      .map(([id]) => id)
      .sort((a, b) => labelOf(a).localeCompare(labelOf(b))),
  );
  const { width: w, height: h, gapX, gapY } = MAP_NODE;
  const width = Math.max(...rows.map((row) => row.length * w + (row.length - 1) * gapX), w);
  const nodes: MapNode[] = rows.flatMap((row, r) => {
    const rowWidth = row.length * w + (row.length - 1) * gapX;
    const left = (width - rowWidth) / 2;
    return row.map((id, i) => ({ id, label: shorten(labelOf(id)), sub: subOf(id), x: left + i * (w + gapX), y: r * (h + gapY) }));
  });
  return { level, nodes, edges, width, height: rows.length > 0 ? rows.length * h + (rows.length - 1) * gapY : 0 };
}
