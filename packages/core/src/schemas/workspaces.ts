import { z } from "zod";
import { isoDate } from "./common.ts";

export const recentWorkspace = z.object({
  /** Absolute path of the folder, as the OS gave it. */
  root: z.string().min(1),
  name: z.string().min(1),
  lastOpenedAt: isoDate,
});
export type RecentWorkspace = z.infer<typeof recentWorkspace>;

/** workspaces.json: the folders opened lately, most recent first (Home screen). */
export const workspaces = z.object({
  schemaVersion: z.literal(1),
  recent: z.array(recentWorkspace).default([]),
});
export type Workspaces = z.infer<typeof workspaces>;

export const MAX_RECENT_WORKSPACES = 20;

export function emptyWorkspaces(): Workspaces {
  return { schemaVersion: 1, recent: [] };
}

/** Puts the folder first (once), keeping at most MAX_RECENT_WORKSPACES. */
export function withRecentWorkspace(doc: Workspaces, entry: RecentWorkspace): Workspaces {
  const others = doc.recent.filter((w) => w.root !== entry.root);
  return { ...doc, recent: [entry, ...others].slice(0, MAX_RECENT_WORKSPACES) };
}

export function withoutRecentWorkspace(doc: Workspaces, root: string): Workspaces {
  return { ...doc, recent: doc.recent.filter((w) => w.root !== root) };
}
