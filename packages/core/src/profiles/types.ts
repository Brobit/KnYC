// What KnYC knows about a framework (VISION §6, design/02 ② and ④, #85). One file per framework in
// this folder, listed in index.ts: the scan's detection id, which files belong to which track, the
// natural build order, how its steps are checked, how to run it, and what lessons should explain.

import type { CheckStrategy } from "../schemas/learning-path.ts";

/** Where a file goes when a project is split into tracks (design/02 ④). */
export type FileTrack = "frontend" | "backend" | "database" | "deployment" | "shared" | "setup";

export interface TrackRule {
  /** Path glob relative to the package root: `*` within a name, `**` across folders. */
  glob: string;
  track: FileTrack;
}

export interface Profile {
  /** The scan's framework id (knyc-analyzer `scan.rs`): "express", "nestjs", "react"… */
  id: string;
  label: string;
  /** The track a project of this framework is mostly about. */
  kind: "frontend" | "backend" | "generic";
  /** First match wins; a file no rule matches goes to `defaultTrack`. */
  trackRules: TrackRule[];
  defaultTrack: FileTrack;
  /** Natural order to rebuild a project, given to the planner as guidance. */
  buildOrder: string[];
  check: {
    /** What a step's checks usually are, given to the planner and to the check writer. */
    hints: string[];
    /** The strategy when a step's own one isn't usable. */
    fallback: CheckStrategy;
  };
  /** How the project runs, for checks against a running server (#88). */
  run?: {
    /** package.json scripts to try, in order. */
    scripts: string[];
    /** Environment variable the server reads its port from. */
    portEnv?: string;
    /** Paths that answer once the server is up, tried in order. */
    readyPaths: string[];
    /** The port the server listens on when it ignores `portEnv` (Vite: 5173). Default 3000. */
    port?: number;
    /** Arguments that give the server its port, "{port}" replaced (Vite: " -- --port {port} --strictPort"). */
    portArgs?: string;
  };
  /**
   * How a package of this framework builds at each step, when its own build needs code that only
   * comes last (Vite bundles from main.tsx, which mounts everything): React type-checks (#92).
   */
  stepBuild?: string;
  /** Architecture notes lessons can use ("a router is mounted on a path prefix…"). */
  lessonHints: string[];
}
