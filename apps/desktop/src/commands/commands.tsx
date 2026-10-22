// Every action the app offers, in one registry (issue #37): the command palette lists them and one
// key handler runs their shortcuts. Each screen or panel registers its own commands while mounted,
// so the list always matches what can be done right now.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type DependencyList, type ReactNode } from "react";

export type CommandGroup = "file" | "editor" | "view" | "terminal" | "run" | "app";
export const GROUPS: CommandGroup[] = ["file", "editor", "terminal", "run", "view", "app"];

export interface Command {
  /** Stable id: "editor.save", "run.start:<root>:<command>". */
  id: string;
  title: string;
  group: CommandGroup;
  /** "Mod+S", "Mod+Shift+P": Mod is ⌘ on macOS and Ctrl elsewhere. The first one is shown. */
  shortcuts?: string[];
  /** Workspace commands need the workspace on screen: the palette shows it first, shortcuts wait for it. */
  scope?: "workspace";
  run: () => void;
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface Shortcut {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Lowercase `KeyboardEvent.key`: follows the keyboard layout, so ⌘K is K on AZERTY too. */
  key: string;
}

export function parseShortcut(text: string): Shortcut {
  const parts = text.split("+");
  const key = parts.pop()!.toLowerCase();
  return { mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), key };
}

export function matches(shortcut: Shortcut, event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, mac = isMac()): boolean {
  const mod = mac ? event.metaKey : event.ctrlKey;
  const other = mac ? event.ctrlKey : event.metaKey;
  return mod === shortcut.mod && !other && event.shiftKey === shortcut.shift && event.altKey === shortcut.alt && event.key.toLowerCase() === shortcut.key;
}

/** "Mod+Shift+P" → "⇧⌘P" on macOS, "Ctrl+Shift+P" elsewhere. */
export function formatShortcut(text: string, mac = isMac()): string {
  const { mod, shift, alt, key } = parseShortcut(text);
  const name = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  if (mac) return `${alt ? "⌥" : ""}${shift ? "⇧" : ""}${mod ? "⌘" : ""}${name}`;
  return [mod && "Ctrl", shift && "Shift", alt && "Alt", name].filter(Boolean).join("+");
}

/**
 * Inside a terminal, Ctrl+letter belongs to the shell (Ctrl+K, Ctrl+W, Ctrl+P… edit the command
 * line). There, only ⌘ shortcuts (macOS), Ctrl+Shift ones and non-letter keys (Ctrl+,) reach the app.
 */
export function reachesAppFromTerminal(shortcut: Shortcut, mac = isMac()): boolean {
  return mac || shortcut.shift || !/^[a-z]$/.test(shortcut.key);
}

export class CommandRegistry {
  private commands = new Map<string, Command>();
  private snapshot: Command[] = [];
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** Adds (or replaces, by id) commands; the returned function removes them. */
  add(commands: Command[]): () => void {
    for (const command of commands) this.commands.set(command.id, command);
    this.emit();
    return () => {
      for (const command of commands) if (this.commands.get(command.id) === command) this.commands.delete(command.id);
      this.emit();
    };
  }

  get(id: string) {
    return this.commands.get(id);
  }

  /** The command whose shortcut this key press is, if any. */
  forEvent(event: KeyboardEvent, inTerminal: boolean, mac = isMac()): Command | undefined {
    for (const command of this.snapshot) {
      for (const text of command.shortcuts ?? []) {
        const shortcut = parseShortcut(text);
        if (matches(shortcut, event, mac) && (!inTerminal || reachesAppFromTerminal(shortcut, mac))) return command;
      }
    }
    return undefined;
  }

  private emit() {
    this.snapshot = [...this.commands.values()];
    for (const listener of this.listeners) listener();
  }
}

interface CommandsContext {
  registry: CommandRegistry;
  /** Runs a command, first bringing the workspace on screen when it needs it. */
  run: (command: Command) => void;
  showWorkspace: () => void;
}

const Context = createContext<CommandsContext | null>(null);

interface CommandsProviderProps {
  children: ReactNode;
  /** Whether the workspace is on screen. */
  workspaceVisible?: boolean;
  showWorkspace?: () => void;
  registry?: CommandRegistry;
}

export function CommandsProvider({ children, workspaceVisible = true, showWorkspace, registry: given }: CommandsProviderProps) {
  const [registry] = useState(() => given ?? new CommandRegistry());

  const value = useMemo<CommandsContext>(
    () => ({
      registry,
      run: (command) => {
        if (command.scope === "workspace" && !workspaceVisible) showWorkspace?.();
        command.run();
      },
      showWorkspace: () => showWorkspace?.(),
    }),
    [registry, workspaceVisible, showWorkspace],
  );

  // Capture phase: shortcuts win over Monaco and the browser (Ctrl+P would print, Ctrl+W close).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const inTerminal = event.target instanceof Element && !!event.target.closest(".xterm");
      const command = registry.forEvent(event, inTerminal);
      if (!command || (command.scope === "workspace" && !workspaceVisible)) return;
      event.preventDefault();
      event.stopPropagation();
      command.run();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [registry, workspaceVisible]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCommands(): CommandsContext {
  const context = useContext(Context);
  if (!context) throw new Error("useCommands must be used inside <CommandsProvider>");
  return context;
}

/**
 * Registers commands while the calling component is mounted. The list (ids, titles, shortcuts) is
 * rebuilt when `deps` change; running a command always calls the latest render's handler, so
 * handlers never see stale state. Outside a CommandsProvider (a panel tested on its own) it does nothing.
 */
export function useRegisterCommands(make: () => Command[], deps: DependencyList) {
  const registry = useContext(Context)?.registry;
  const latest = useRef(make);
  latest.current = make;
  useEffect(
    () =>
      registry?.add(
        latest.current().map((command) => ({
          ...command,
          run: () => (latest.current().find((c) => c.id === command.id) ?? command).run(),
        })),
      ),
    [registry, ...deps],
  );
}
