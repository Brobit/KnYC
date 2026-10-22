// The project's commands and their runs (src-tauri/src/run.rs), or a pretend runner for
// `pnpm dev` in a plain browser.
import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/settings";

export interface ProjectCommand {
  kind: "install" | "build" | "test" | "run" | "script";
  name: string;
  command: string;
}

export interface PackageCommands {
  root: string;
  name: string | null;
  commands: ProjectCommand[];
}

export type RunEvent =
  | { type: "output"; stream: "stdout" | "stderr"; data: string }
  | { type: "exit"; exitCode: number | null; durationMs: number; stopped: boolean };

export interface RunBackend {
  /** Commands found by the scan of the open folder, per package.json. */
  commands(): Promise<PackageCommands[]>;
  start(command: string, root: string, onEvent: (event: RunEvent) => void): Promise<number>;
  /** Stops the command and every process it started; its exit event follows. */
  stop(id: number): Promise<void>;
}

export function createTauriRunBackend(): RunBackend {
  return {
    commands: () => invoke("run_commands"),
    start: (command, root, onEvent) => invoke<number>("run_start", { command, root, onEvent: new Channel<RunEvent>(onEvent) }),
    stop: (id) => invoke("run_stop", { id }),
  };
}

/** Prints a few lines per command; `run` keeps printing until stopped, like a dev server. */
export function createFakeRunBackend(tickMs = 400): RunBackend {
  let nextId = 0;
  const stops = new Map<number, () => void>();
  return {
    async commands() {
      return [
        {
          root: ".",
          name: "express-notes",
          commands: [
            { kind: "install", name: "install", command: "npm install" },
            { kind: "test", name: "test", command: "npm run test" },
            { kind: "run", name: "run", command: "npm run start" },
            { kind: "script", name: "lint", command: "npm run lint" },
          ],
        },
      ];
    },
    async start(command, _root, onEvent) {
      const id = ++nextId;
      const started = Date.now();
      const forever = command.endsWith("start");
      let line = 0;
      const finish = (exitCode: number | null, stopped: boolean) => {
        clearInterval(timer);
        stops.delete(id);
        onEvent({ type: "exit", exitCode, durationMs: Date.now() - started, stopped });
      };
      const timer = setInterval(() => {
        line += 1;
        if (forever) {
          onEvent({ type: "output", stream: "stdout", data: `\x1b[32m[server]\x1b[0m GET /notes 200 (${line})\n` });
        } else if (line <= 3) {
          onEvent({ type: "output", stream: line === 2 ? "stderr" : "stdout", data: `${command}: step ${line}/3\n` });
        } else {
          finish(command.includes("lint") ? 1 : 0, false);
        }
      }, tickMs);
      onEvent({ type: "output", stream: "stdout", data: `\x1b[2m> ${command} (browser preview)\x1b[0m\n` });
      stops.set(id, () => finish(null, true));
      return id;
    },
    async stop(id) {
      stops.get(id)?.();
    },
  };
}

export const runBackend: RunBackend = isTauri() || !import.meta.env.DEV ? createTauriRunBackend() : createFakeRunBackend();
