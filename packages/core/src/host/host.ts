// What the pipeline needs from the system (design/06 H3): files, git and the knyc-sys steps.
// The CLI implements it with Node (host/node.ts); the desktop app with Tauri commands in Rust. The
// pipeline itself never imports node:* modules, so the same code runs in both.

import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** A knyc-sys step. Results are the JSON knyc-sys prints, validated by the caller. */
export type SysRequest =
  | { op: "intake"; source: string; sandbox: string }
  | { op: "scan"; folder: string; toolchains: boolean }
  | { op: "graph"; folder: string }
  | {
      op: "run";
      cwd: string;
      /** Shell command line: "npm run build". */
      command: string;
      timeoutMs: number;
      env: Record<string, string>;
      /** Jest/Vitest JSON report the command writes, relative to cwd. */
      report?: string;
      /** Docker mode (#91): run in this image, `mount` mounted at /work (cwd inside it). */
      container?: Container;
    }
  | {
      /** A Docker check (#90): build the image (and run it), then remove what it made. */
      op: "docker";
      cwd: string;
      timeoutMs: number;
      spec: DockerSpec;
    }
  | {
      /** An HTTP check (#88): start the server in cwd, wait for it, send the requests, stop it. */
      op: "http";
      cwd: string;
      timeoutMs: number;
      server: HttpServer;
      requests: HttpRequest[];
      container?: Container;
    }
  | {
      /** A UI check (#89): start the frontend in cwd, run the UI tests in Chromium, stop it. */
      op: "ui";
      cwd: string;
      timeoutMs: number;
      server: HttpServer;
      /** Absolute paths of the UI test modules. */
      tests: string[];
      /** KnYC's Chromium folder; the app always uses its own and ignores this. */
      browsers?: string;
      container?: Container;
    }
  | {
      /** Chromium for the UI checks (#89). */
      op: "browser";
      action: "status" | "size" | "install";
      browsers?: string;
    };

/** Docker mode (#91): the toolchain image and the folder mounted at /work. */
export interface Container {
  image: string;
  mount: string;
}

/** What a Docker check builds and runs (knyc-runner `docker.rs`); paths relative to cwd. */
export interface DockerSpec {
  context: string;
  dockerfile: string;
  run?: { port: number; healthPath: string };
}

/** How to start a project's server for an HTTP check (knyc-runner `http.rs`). */
export interface HttpServer {
  /** Shell command line: "npm run start". */
  start: string;
  /** The port the original listens on when it doesn't read `portEnv`. */
  port: number;
  readyPath: string;
  env?: Record<string, string>;
  /** Default "PORT". */
  portEnv?: string;
}

export interface HttpRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  expect: { status: number; jsonSubset?: unknown; bodyIncludes?: string[] };
}

export interface Host {
  /** UTF-8 text; rejects when the file doesn't exist. */
  readFile(path: string): Promise<string>;
  /** Creates parent folders; replaces the file atomically (no half-written file after a crash). */
  writeFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  /** Creates parent folders of `to`. */
  copyFile(from: string, to: string): Promise<void>;
  /** A file or a whole folder; nothing happens when it doesn't exist. */
  remove(path: string): Promise<void>;
  /** Runs git in `cwd`; resolves to its trimmed stdout, rejects on a non-zero exit. */
  git(cwd: string, args: string[]): Promise<string>;
  /** Runs a knyc-sys step; resolves to its JSON result, rejects with a KnycSysError. */
  sys(request: SysRequest): Promise<unknown>;
}

/** SHA-256 of a UTF-8 string, as hex: cache keys and file hashes. Works in Node and the webview. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/**
 * Joins path parts with "/", which Node and Rust accept on every OS ("C:\\work" + "a/b.ts" →
 * "C:\\work/a/b.ts"). No "..": the pipeline only builds paths inside folders it was given.
 */
export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== "")
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join("/");
}

/** Everything before the last "/" or "\\": "src/a/b.ts" → "src/a"; "b.ts" → "". */
export function dirnamePath(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at < 0 ? "" : path.slice(0, at);
}
