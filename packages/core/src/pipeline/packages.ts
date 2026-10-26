// Projects with several packages (#87, design/03 `frameworks[].root`): `apps/web` + `apps/api`,
// npm / yarn / pnpm workspaces. Each package installs, builds and runs its tests in its own folder;
// a workspace root installs once for all of them (and builds them all when it has a build script).

import type { Scan } from "../sys/knyc-sys.ts";

/** A project's commands per package: the scan's, or project.json's (which leave out empty ones). */
export type PackageCommands = { root: string; install?: string | null; build?: string | null; test?: string | null; run?: string | null }[];

export interface PackageCommand {
  /** Package folder, relative to the project ("." for the root). */
  root: string;
  command: string;
}

/**
 * The scan's commands, ready to run: in a workspace, the root's install covers every package, and
 * its build (when it has one) builds them all, so the packages' own installs and builds go.
 */
export function packageCommands(scan: Pick<Scan, "commands" | "packages">): PackageCommands {
  const workspace = (scan.packages ?? []).some((p) => p.root === "." && (p as { workspaces?: boolean }).workspaces === true);
  const root = scan.commands.find((c) => c.root === ".");
  if (!workspace || !root) return scan.commands;
  return scan.commands.map((c) => (c.root === "." ? c : { ...c, install: root.install ? null : c.install, build: root.build ? null : c.build }));
}

const each = (commands: PackageCommands, key: "install" | "build"): PackageCommand[] =>
  commands.flatMap((c) => (c[key] ? [{ root: c.root, command: c[key]! }] : []));

/** What installs the dependencies, package by package (root first). */
export const installs = (commands: PackageCommands) => each(commands, "install");

/** What builds the project, package by package (root first). */
export const builds = (commands: PackageCommands) => each(commands, "build");

/** The package a file belongs to: the deepest package folder that holds it. */
export function packageOf(roots: string[], path: string): string {
  return (
    roots
      .filter((root) => root === "." || path === root || path.startsWith(`${root}/`))
      .sort((a, b) => (b === "." ? -1 : b.split("/").length) - (a === "." ? -1 : a.split("/").length))[0] ?? "."
  );
}

/** `path` relative to its package folder. */
export const inPackage = (root: string, path: string) => (root === "." ? path : path.slice(root.length + 1));
