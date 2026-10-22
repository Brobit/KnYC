// Read-only output of one run, in xterm.js so colors and progress bars from npm, vite or jest
// render as in a terminal. Replays the stored output when another run is shown.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { readCssTokens } from "@/editor/monaco-theme";
import { buildXtermTheme } from "@/terminal/xterm-theme";
import type { RunOutput } from "./RunPanel";

export interface OutputViewProps {
  /** The run to show; null shows nothing. */
  output: RunOutput | null;
  theme: string;
  mode: "light" | "dark";
  fontSize: number;
}

export function OutputView({ output, theme, mode, fontSize }: OutputViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: readCssTokens()("font-code"),
      fontSize,
      convertEol: true,
      disableStdin: true,
      cursorStyle: "bar",
      cursorInactiveStyle: "none",
      scrollback: 10000,
      theme: buildXtermTheme(readCssTokens(), mode),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    termRef.current = term;
    fitRef.current = fit;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0 && element.clientHeight > 0) requestAnimationFrame(() => fit.fit());
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
    // Created once; theme, font and output changes are applied below.
  }, []);

  // Replay the shown run, then follow what it prints next.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.reset();
    if (!output) return;
    for (const chunk of output.chunks) term.write(chunk);
    return output.subscribe((chunk) => term.write(chunk));
  }, [output]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const frame = requestAnimationFrame(() => {
      term.options.theme = buildXtermTheme(readCssTokens(), mode);
      term.options.fontSize = fontSize;
      fitRef.current?.fit();
    });
    return () => cancelAnimationFrame(frame);
  }, [theme, mode, fontSize]);

  return <div ref={host} className="absolute inset-0 py-1 pl-2" />;
}
