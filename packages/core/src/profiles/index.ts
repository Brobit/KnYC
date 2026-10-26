// Framework profiles (VISION §6, #85). Adding a framework = one file in this folder, listed in
// PROFILES, plus its golden repo. A project no profile knows gets the generic one.

import { express } from "./express.ts";
import { nestjs } from "./nestjs.ts";
import { generic } from "./generic.ts";
import { matchesGlob } from "./glob.ts";
import type { FileTrack, Profile } from "./types.ts";

export type { FileTrack, Profile, TrackRule } from "./types.ts";
export { generic } from "./generic.ts";
export { globToRegExp, matchesGlob } from "./glob.ts";

export const PROFILES: Profile[] = [express, nestjs];

/** Profiles by the scan's framework id. */
export const profiles: Record<string, Profile> = Object.fromEntries(PROFILES.map((p) => [p.id, p]));

/**
 * Frontend frameworks the scan detects (knyc-analyzer `scan.rs` ids). Their profiles come in M4
 * (#92–#95); until then the overview still knows they aren't backends.
 */
const FRONTEND_IDS = new Set(["react", "nextjs", "vue", "nuxt", "angular", "svelte", "sveltekit"]);

export const isFrontendFramework = (id: string) => profiles[id]?.kind === "frontend" || FRONTEND_IDS.has(id);

/** The profile of a project, from the scan's frameworks ("express 4.21" or "express"); generic when none is known. */
export function profileFor(frameworks: string[]): Profile {
  return frameworks.map((f) => profiles[f.split(" ")[0]!]).find((p): p is Profile => p !== undefined) ?? generic;
}

/** A label for a framework id, known or not ("express" → "Express", "koa" → "Koa"). */
export const frameworkLabel = (id: string) => profiles[id]?.label ?? id.charAt(0).toUpperCase() + id.slice(1);

/** The track a file belongs to under a profile's rules (`path` relative to the package root). */
export function trackOf(profile: Profile, path: string): FileTrack {
  return profile.trackRules.find((rule) => matchesGlob(path, rule.glob))?.track ?? profile.defaultTrack;
}
