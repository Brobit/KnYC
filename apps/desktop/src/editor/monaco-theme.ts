// Monaco themes generated from the design tokens (design 07: "every color in the app, Monaco and
// xterm.js comes from these tokens"). One theme per theme × mode, rebuilt when either changes.
import type { editor } from "monaco-editor";

/** Reads a token (e.g. "accent") as a #rrggbb color. */
export type TokenReader = (name: string) => string;

export function readCssTokens(element: Element = document.documentElement): TokenReader {
  const style = getComputedStyle(element);
  return (name) => style.getPropertyValue(`--${name}`).trim();
}

const hex = (color: string) => color.replace(/^#/, "").toLowerCase();
/** #rrggbb + alpha (0–1) as #rrggbbaa, for selections and highlights. */
const alpha = (color: string, opacity: number) =>
  `#${hex(color).slice(0, 6)}${Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0")}`;

export function themeName(theme: string, mode: "light" | "dark") {
  return `knyc-${theme}-${mode}`;
}

export function buildMonacoTheme(token: TokenReader, mode: "light" | "dark"): editor.IStandaloneThemeData {
  const t = (name: string) => {
    const value = token(name);
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`token --${name} is not a #rrggbb color: "${value}"`);
    return value;
  };
  const rule = (scope: string, name: string, fontStyle?: string) => ({ token: scope, foreground: hex(t(name)), fontStyle });
  return {
    base: mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: hex(t("text-primary")) },
      rule("comment", "text-muted", "italic"),
      rule("keyword", "accent"),
      rule("keyword.flow", "accent"),
      rule("string", "success"),
      rule("string.key.json", "accent-2"),
      rule("string.value.json", "success"),
      rule("number", "warning"),
      rule("regexp", "danger"),
      rule("type", "accent-2"),
      rule("type.identifier", "accent-2"),
      rule("tag", "accent"),
      rule("attribute.name", "accent-2"),
      rule("attribute.value", "success"),
      rule("delimiter", "text-secondary"),
      rule("variable.predefined", "track-frontend"),
    ],
    colors: {
      "editor.background": t("surface-editor"),
      "editor.foreground": t("text-primary"),
      "editorLineNumber.foreground": t("text-muted"),
      "editorLineNumber.activeForeground": t("text-secondary"),
      "editorCursor.foreground": t("accent"),
      "editor.lineHighlightBackground": alpha(t("surface-2"), mode === "dark" ? 0.6 : 0.8),
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": alpha(t("accent"), mode === "dark" ? 0.35 : 0.22),
      "editor.inactiveSelectionBackground": alpha(t("accent"), 0.12),
      "editor.findMatchHighlightBackground": alpha(t("warning"), 0.3),
      "editorIndentGuide.background1": t("border"),
      "editorIndentGuide.activeBackground1": t("border-strong"),
      "editorWhitespace.foreground": t("border-strong"),
      "editorBracketHighlight.foreground1": t("accent"),
      "editorBracketHighlight.foreground2": t("accent-2"),
      "editorBracketHighlight.foreground3": t("track-frontend"),
      "editorBracketHighlight.unexpectedBracket.foreground": t("danger"),
      "editorBracketMatch.border": t("accent"),
      "editorBracketMatch.background": alpha(t("accent"), 0.12),
      "editorError.foreground": t("danger"),
      "editorWarning.foreground": t("warning"),
      "editorGutter.background": t("surface-editor"),
      "editorWidget.background": t("surface"),
      "editorWidget.border": t("border"),
      "editorSuggestWidget.background": t("surface"),
      "editorSuggestWidget.border": t("border"),
      "editorSuggestWidget.selectedBackground": t("accent-soft"),
      "editorHoverWidget.background": t("surface"),
      "editorHoverWidget.border": t("border"),
      "input.background": t("bg"),
      "input.border": t("border-strong"),
      focusBorder: t("accent"),
      "scrollbarSlider.background": alpha(t("text-muted"), 0.25),
      "scrollbarSlider.hoverBackground": alpha(t("text-muted"), 0.4),
      "scrollbarSlider.activeBackground": alpha(t("text-muted"), 0.5),
      "minimap.background": t("surface-editor"),
    },
  };
}
