// The secret guard's last line (design/02 ①): lines the Rust scan flagged as possible secrets
// are replaced before any file content goes to an AI provider.

export const REDACTED = "[line removed by KnYC: possible secret]";

/** `lines` are 1-based line numbers of `content` to redact. */
export function redact(content: string, lines: Iterable<number>): string {
  const remove = new Set(lines);
  if (remove.size === 0) return content;
  return content
    .split("\n")
    .map((line, i) => {
      if (!remove.has(i + 1)) return line;
      const indent = line.match(/^\s*/)?.[0] ?? "";
      return `${indent}${REDACTED}${line.endsWith("\r") ? "\r" : ""}`;
    })
    .join("\n");
}

/** Groups secret lines per file: path → line numbers. */
export function secretLinesByFile(secretLines: { path: string; line: number }[]): Map<string, number[]> {
  const byFile = new Map<string, number[]>();
  for (const { path, line } of secretLines) {
    byFile.set(path, [...(byFile.get(path) ?? []), line]);
  }
  return byFile;
}
