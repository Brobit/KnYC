import { z } from "zod";
import { isoDate, languageId, trackId, unitId } from "./common.ts";

export const contract = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("http"),
    method: z.string().min(1),
    path: z.string().startsWith("/"),
    requestShape: z.string().optional(),
    responseShape: z.string().optional(),
  }),
  z.object({ kind: z.literal("db-table"), name: z.string().min(1), columns: z.array(z.string()) }),
  z.object({ kind: z.literal("env"), name: z.string().min(1) }),
]);
export type Contract = z.infer<typeof contract>;

export const track = z.object({
  id: trackId,
  label: z.string().min(1),
  units: z.array(unitId),
  loc: z.number().int().min(0),
  contracts: z.array(contract).default([]),
  /** Who provides this track's code when it isn't the one being learned. */
  providedBy: z.enum(["original", "mock", "learner"]).default("original"),
});
export type Track = z.infer<typeof track>;

/** `.knyc/project.json`: the scan part is filled from Rust output, the rest by TS. */
export const project = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.object({
    path: z.string().min(1),
    hash: z.string().min(1),
    gitCommit: z.string().optional(),
  }),
  createdAt: isoDate,
  languages: z.array(z.object({ id: languageId, loc: z.number().int().min(0) })),
  frameworks: z.array(
    z.object({ profileId: z.string().min(1), version: z.string().optional(), root: z.string() }),
  ),
  toolchains: z.array(
    z.object({
      id: z.enum(["node", "python", "go", "dotnet", "docker"]),
      required: z.string(),
      found: z.string().optional(),
    }),
  ),
  commands: z.array(
    z.object({
      root: z.string(),
      install: z.string().optional(),
      build: z.string().optional(),
      test: z.string().optional(),
      run: z.string().optional(),
    }),
  ),
  tracks: z.array(track),
  excluded: z.array(
    z.object({ path: z.string().min(1), reason: z.enum(["secret", "ignored", "binary", "too-large"]) }),
  ),
});
export type Project = z.infer<typeof project>;
