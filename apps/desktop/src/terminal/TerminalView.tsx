// One xterm.js terminal attached to one shell. It stays mounted while its tab is hidden, so the
// scrollback and the running program survive switching tabs.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { readCssTokens } from "@/editor/monaco-theme";
import { cn } from "@/lib/utils";
import type { TerminalBackend } from "./terminal-backend";
import { buildXtermTheme } from "./xterm-theme";

export interface TerminalViewProps {
  backend: TerminalBackend;
  active: boolean;
  theme: string;
  mode: "light" | "dark";
  fontSize: number;
  /** Bumped when the terminal should take the keyboard (its panel was shown). */
  focusRequest?: number;
  onExit: (code: number | null) => void;
}

/** Copy with a selection (else Ctrl+C interrupts the program, as in any terminal); paste from the clipboard. */
function clipboardKeys(term: Terminal) {
  return (event: KeyboardEvent) => {
    if (event.type !== "keydown" || !(event.ctrlKey || event.metaKey)) return true;
    const key = event.key.toLowerCase();
    if (key === "c" && (event.shiftKey || term.hasSelection())) {
      if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      event.preventDefault();
      return false;
    }
    if (key === "v") {
      event.preventDefault();
      void navigator.clipboard.readText().then((text) => term.paste(text));
      return false;
    }
    return true;
  };
}

export function TerminalView({ backend, active, theme, mode, fontSize, focusRequest = 0, onExit }: TerminalViewProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<number | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Size the terminal to its panel and tell the shell, so programs reflow.
  const fit = () => {
    const term = termRef.current;
    const element = host.current;
    if (!term || !element || element.clientWidth === 0 || element.clientHeight === 0) return;
    fitRef.current?.fit();
    if (idRef.current !== null) void backend.resize(idRef.current, term.cols, term.rows).catch(() => {});
  };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: readCssTokens()("font-code"),
      fontSize,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: buildXtermTheme(readCssTokens(), mode),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.attachCustomKeyEventHandler(clipboardKeys(term));
    term.open(element);
    termRef.current = term;
    fitRef.current = fitAddon;
    if (element.clientWidth > 0) fitAddon.fit();

    // Typing before the shell is up is kept and sent once it is.
    let closed = false;
    const queued: string[] = [];
    const input = term.onData((data) => {
      if (idRef.current === null) queued.push(data);
      else void backend.write(idRef.current, data).catch(() => {});
    });
    backend
      .open(term.cols, term.rows, (event) => {
        if (event.type === "output") term.write(event.data);
        else {
          term.write(`\r\n\x1b[2m${t("terminal.exited", { code: event.code ?? "?" })}\x1b[0m\r\n`);
          idRef.current = null;
          onExitRef.current(event.code);
        }
      })
      .then((id) => {
        if (closed) return void backend.close(id);
        idRef.current = id;
        for (const data of queued.splice(0)) void backend.write(id, data);
      })
      .catch((error: unknown) => term.write(`\x1b[31m${t("terminal.failed", { detail: String(error) })}\x1b[0m\r\n`));

    const observer = new ResizeObserver(() => requestAnimationFrame(fit));
    observer.observe(element);
    return () => {
      closed = true;
      observer.disconnect();
      input.dispose();
      if (idRef.current !== null) void backend.close(idRef.current);
      idRef.current = null;
      term.dispose();
      termRef.current = null;
    };
    // The shell lives as long as the view; theme and font changes are applied below.
  }, [backend]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    // After ThemeRoot has applied the new attributes on <html>.
    const frame = requestAnimationFrame(() => {
      term.options.theme = buildXtermTheme(readCssTokens(), mode);
      term.options.fontSize = fontSize;
      fit();
    });
    return () => cancelAnimationFrame(frame);
  }, [theme, mode, fontSize]);

  useEffect(() => {
    if (!active) return;
    // Two frames: after dockview has finished moving focus to its container.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        fit();
        termRef.current?.focus();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, focusRequest]);

  // dockview focuses its panel overlay on click (to activate the group); hand focus back to the terminal.
  return <div ref={host} onClick={() => termRef.current?.focus()} className={cn("absolute inset-0 py-1 pl-2", !active && "invisible")} />;
}
