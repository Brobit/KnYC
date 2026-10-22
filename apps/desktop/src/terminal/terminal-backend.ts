// Shells behind the terminal panel: the Rust PTY in the desktop app (src-tauri/src/terminal.rs),
// a pretend shell for `pnpm dev` in a plain browser, where nothing can run.
import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/settings";

export type TerminalEvent = { type: "output"; data: string } | { type: "exit"; code: number | null };

export interface TerminalBackend {
  /** Starts a shell in the workspace folder; events arrive in order on `onEvent`. */
  open(cols: number, rows: number, onEvent: (event: TerminalEvent) => void): Promise<number>;
  write(id: number, data: string): Promise<void>;
  resize(id: number, cols: number, rows: number): Promise<void>;
  close(id: number): Promise<void>;
}

export function createTauriTerminalBackend(): TerminalBackend {
  return {
    open: (cols, rows, onEvent) => invoke<number>("terminal_open", { cols, rows, onEvent: new Channel<TerminalEvent>(onEvent) }),
    write: (id, data) => invoke("terminal_write", { id, data }),
    resize: (id, cols, rows) => invoke("terminal_resize", { id, cols, rows }),
    close: (id) => invoke("terminal_close", { id }),
  };
}

/** Echoes what is typed and answers every command with a note: enough to work on the panel itself. */
export function createFakeTerminalBackend(prompt = "$ "): TerminalBackend {
  const shells = new Map<number, { line: string; emit: (event: TerminalEvent) => void }>();
  let nextId = 0;
  const output = (id: number, data: string) => shells.get(id)?.emit({ type: "output", data });
  return {
    async open(_cols, _rows, onEvent) {
      const id = ++nextId;
      shells.set(id, { line: "", emit: onEvent });
      setTimeout(() => output(id, `\x1b[2mBrowser preview: commands do not run here.\x1b[0m\r\n${prompt}`));
      return id;
    },
    async write(id, data) {
      const shell = shells.get(id);
      if (!shell) throw new Error(`terminal ${id} is closed`);
      for (const char of data) {
        if (char === "\r") {
          const command = shell.line.trim();
          shell.line = "";
          if (command === "exit") {
            output(id, "\r\n");
            shells.delete(id);
            shell.emit({ type: "exit", code: 0 });
            return;
          }
          output(id, command ? `\r\n${command}: not run in the browser preview\r\n${prompt}` : `\r\n${prompt}`);
        } else if (char === "\x7f") {
          if (shell.line) {
            shell.line = shell.line.slice(0, -1);
            output(id, "\b \b");
          }
        } else if (char >= " ") {
          shell.line += char;
          output(id, char);
        }
      }
    },
    async resize() {},
    async close(id) {
      shells.delete(id);
    },
  };
}

export const terminalBackend: TerminalBackend = isTauri() || !import.meta.env.DEV ? createTauriTerminalBackend() : createFakeTerminalBackend();
