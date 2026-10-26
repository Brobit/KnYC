// Stage ④ (design/02, #86): which track each source file belongs to, and the contracts between
// tracks. A file gets the profile of the framework whose package holds it (a monorepo can have a
// React `web/` and an Express `api/`); that profile's rules place it, else its default track. Only
// files no rule places in a project with both a frontend and a backend framework are left to the
// AI. When a learner picks one track, the plan, the timeline and the checks run over that track's
// units: every other file stays the original code (design/02 "Starting the learner's workspace").

import { z } from "zod";
import type { AiClient } from "../ai/client.ts";
import { generic, isFrontendFramework, matchesGlob, profiles, type FileTrack, type Profile } from "../profiles/index.ts";
import type { TrackId } from "../schemas/common.ts";
import type { Contract } from "../schemas/project.ts";
import type { Graph, Scan } from "../sys/knyc-sys.ts";
import type { Summaries } from "./summaries.ts";
import type { Units } from "./units.ts";

/** Tracks a learner can pick (besides the full project). */
export const CODE_TRACKS = ["frontend", "backend", "database", "deployment"] as const;
export type CodeTrack = (typeof CODE_TRACKS)[number];

export interface TrackContract {
  /** The track that provides it (the backend serves an endpoint, reads an env var…). */
  track: FileTrack;
  contract: Contract;
}

/** `<cache>/tracks.json` */
export interface TrackSplit {
  /** Source file → its track. */
  files: Record<string, FileTrack>;
  /** Files the profiles couldn't place; the AI classified them (or they wait for it). */
  leftovers: string[];
  contracts: TrackContract[];
}

/** A framework's profile; a frontend framework without one yet still counts as frontend. */
function profileForFramework(id: string): Profile {
  const known = profiles[id];
  if (known) return known;
  return isFrontendFramework(id) ? { ...generic, id, kind: "frontend", defaultTrack: "frontend" } : generic;
}

const inRoot = (path: string, root: string) => root === "." || root === "" || path === root || path.startsWith(`${root}/`);
const relative = (path: string, root: string) => (root === "." || root === "" ? path : path.slice(root.length + 1));

/** The tracks the profiles give each source file; files they can't place are listed as leftovers. */
export function splitByRules(scan: Scan, graph: Graph): TrackSplit {
  const frameworks = scan.frameworks.map((f) => ({ root: f.root, profile: profileForFramework(f.profileId) }));
  const kinds = new Set(frameworks.map((f) => f.profile.kind));
  const mixed = kinds.has("frontend") && kinds.has("backend");
  const files: Record<string, FileTrack> = {};
  const leftovers: string[] = [];

  for (const file of graph.files) {
    if (file.test) continue;
    // The closest package with a framework; several at the same root are tried in turn.
    const holding = frameworks.filter((f) => inRoot(file.path, f.root));
    const depth = Math.max(-1, ...holding.map((f) => (f.root === "." ? 0 : f.root.split("/").length)));
    const closest = holding.filter((f) => (f.root === "." ? 0 : f.root.split("/").length) === depth);
    const candidates = closest.length > 0 ? closest.map((f) => ({ profile: f.profile, path: relative(file.path, f.root) })) : [{ profile: generic, path: file.path }];

    const ruled = candidates.map((c) => c.profile.trackRules.find((rule) => matchesGlob(c.path, rule.glob))?.track).find(Boolean);
    if (ruled) files[file.path] = ruled;
    else if (candidates.length === 1 && (candidates[0]!.profile.kind !== "generic" || !mixed)) files[file.path] = candidates[0]!.profile.defaultTrack;
    else {
      // Two frameworks at the same root, or no framework in a full-stack project: the AI decides.
      files[file.path] = candidates[0]!.profile.defaultTrack;
      leftovers.push(file.path);
    }
  }
  // "Shared" means shared between tracks: with a single code track (an Express API alone), its
  // shared folder is part of that track and is taught with it.
  const code = new Set(Object.values(files).filter((t): t is CodeTrack => (CODE_TRACKS as readonly string[]).includes(t)));
  if (code.size <= 1 && leftovers.length === 0) {
    const only = [...code][0] ?? "backend";
    for (const [path, track] of Object.entries(files)) if (track === "shared") files[path] = only;
  }
  return { files, leftovers, contracts: [] };
}

export const leftoverAnswer = z.object({
  files: z.array(z.object({ path: z.string(), track: z.enum(["frontend", "backend", "database", "deployment", "shared", "setup"]) })),
});

export function leftoverPrompt(split: TrackSplit, summaries: Summaries): string {
  const roles = new Map(summaries.files.map((f) => [f.path, f.role]));
  const placed = Object.entries(split.files).filter(([path]) => !split.leftovers.includes(path));
  return `${summaries.project.name}: ${summaries.project.purpose}
Architecture: ${summaries.project.architecture}

# Files already placed (examples)
${placed
  .slice(0, 40)
  .map(([path, track]) => `- ${path}: ${track}`)
  .join("\n")}

# Files to place
${split.leftovers.map((path) => `- ${path}${roles.has(path) ? `: ${roles.get(path)}` : ""}`).join("\n")}

Give each file to place its track: "frontend" (UI in the browser), "backend" (server, API), "database" (schema, migrations, queries), "deployment" (containers, CI), "shared" (types or helpers several tracks use) or "setup" (configuration).
Answer as JSON: { "files": [{ "path": "...", "track": "..." }] } with every file to place.`;
}

/** Lets the AI place the leftovers (one cheap call); a file it skips keeps its default. */
export async function classifyLeftovers(client: AiClient, split: TrackSplit, summaries: Summaries): Promise<TrackSplit> {
  if (split.leftovers.length === 0) return split;
  const result = await client.generate({ role: "summaries", system: "You sort a project's files into tracks for KnYC, an app that teaches a codebase track by track.", prompt: leftoverPrompt(split, summaries), schema: leftoverAnswer });
  const files = { ...split.files };
  for (const { path, track } of result.data.files) if (path in files && split.leftovers.includes(path)) files[path] = track;
  return { ...split, files };
}

const HTTP_ROUTE = /\b(?:app|router|server|fastify|api|routes?)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*(['"`])(\/[^'"`]*)\2/gi;
const ENV_VAR = /\bprocess\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])|\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)/g;
const PRISMA_MODEL = /^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm;
const SQL_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?\s*\(([\s\S]*?)\);/gi;

/**
 * The contracts other tracks rely on, read from the code without AI: the routes the backend
 * declares (as written in their router: a prefix mounted elsewhere isn't added), the environment
 * variables each track reads, the tables the database defines.
 */
export function extractContracts(sources: Map<string, string>, split: TrackSplit): TrackContract[] {
  const found = new Map<string, TrackContract>();
  const add = (track: FileTrack, contract: Contract) => {
    const key = `${track}:${JSON.stringify(contract)}`;
    if (!found.has(key)) found.set(key, { track, contract });
  };
  for (const [path, code] of sources) {
    const track = split.files[path] ?? (path.endsWith(".prisma") || path.endsWith(".sql") ? "database" : undefined);
    if (!track) continue;
    if (track === "backend") for (const m of code.matchAll(HTTP_ROUTE)) add(track, { kind: "http", method: m[1]!.toUpperCase() === "ALL" ? "ANY" : m[1]!.toUpperCase(), path: m[3]! });
    for (const m of code.matchAll(ENV_VAR)) add(track, { kind: "env", name: (m[1] ?? m[2] ?? m[3])! });
    if (path.endsWith(".prisma")) {
      for (const m of code.matchAll(PRISMA_MODEL)) {
        const columns = m[2]!.split("\n").map((l) => l.trim().split(/\s+/)[0]!).filter((c) => /^\w+$/.test(c));
        add("database", { kind: "db-table", name: m[1]!, columns });
      }
    }
    if (path.endsWith(".sql")) {
      for (const m of code.matchAll(SQL_TABLE)) {
        const columns = m[2]!.split(",").map((c) => c.trim().split(/\s+/)[0]!.replace(/["`]/g, "")).filter((c) => /^\w+$/.test(c) && !/^(primary|foreign|unique|constraint|check)$/i.test(c));
        add("database", { kind: "db-table", name: m[1]!, columns });
      }
    }
  }
  return [...found.values()];
}

/** The units a path over `track` teaches; the rest of the code stays the original. */
export function unitsForTrack(units: Units, split: TrackSplit | undefined, track: TrackId): Units {
  if (track === "full" || !split) return units;
  const keep = new Set(units.atoms.filter((a) => split.files[a.file] === track).map((a) => a.id));
  const atoms = units.atoms.filter((a) => keep.has(a.id));
  const byFile = new Map([...units.byFile].filter(([file]) => split.files[file] === track));
  // What a unit needs from another track is there from the start (the original code).
  const needs = new Map(atoms.map((a) => [a.id, new Set([...(units.needs.get(a.id) ?? [])].filter((n) => keep.has(n)))]));
  return { atoms, byId: new Map(atoms.map((a) => [a.id, a])), byFile, needs };
}

/** The tracks this project has code for, in the usual order. */
export function tracksWithCode(split: TrackSplit): CodeTrack[] {
  const present = new Set(Object.values(split.files));
  return CODE_TRACKS.filter((track) => present.has(track));
}
