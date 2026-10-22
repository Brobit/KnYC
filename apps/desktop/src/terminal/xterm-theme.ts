// The terminal's colors from the design tokens (design 07), like the Monaco themes: the 16 ANSI
// colors map onto the semantic tokens, so `ls`, git and test runners stay in the app's palette.
import type { ITheme } from "@xterm/xterm";
import type { TokenReader } from "@/editor/monaco-theme";

export function buildXtermTheme(token: TokenReader, mode: "light" | "dark"): ITheme {
  const dark = mode === "dark";
  return {
    background: token("surface-editor"),
    foreground: token("text-primary"),
    cursor: token("accent"),
    cursorAccent: token("surface-editor"),
    selectionBackground: `${token("accent")}${dark ? "59" : "38"}`,
    // On a light background "black" text must stay readable and "white" must not vanish.
    black: dark ? token("border-strong") : token("text-primary"),
    red: token("danger"),
    green: token("success"),
    yellow: token("warning"),
    blue: token("accent"),
    magenta: token("track-frontend"),
    cyan: token("accent-2"),
    white: dark ? token("text-secondary") : token("text-muted"),
    brightBlack: token("text-muted"),
    brightRed: token("danger"),
    brightGreen: token("success"),
    brightYellow: token("warning"),
    brightBlue: token("accent"),
    brightMagenta: token("track-deployment"),
    brightCyan: token("accent-2"),
    brightWhite: dark ? token("text-primary") : token("text-secondary"),
  };
}
