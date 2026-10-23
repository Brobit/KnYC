// The Markdown lessons use (#62): headings, paragraphs, lists, code blocks, inline code, bold and
// italic. Built as React elements, never as HTML, so a model's answer can't inject markup.
import type { ReactNode } from "react";

type Block = { kind: "heading"; level: number; text: string } | { kind: "paragraph"; text: string } | { kind: "list"; ordered: boolean; items: string[] } | { kind: "code"; text: string };

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith("```"); i++) code.push(lines[i]!);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]! });
    } else if (item) {
      flush();
      const ordered = item[2] !== undefined;
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item[3]!);
      else blocks.push({ kind: "list", ordered, items: [item[3]!] });
    } else if (!line.trim()) {
      flush();
    } else {
      const last = blocks[blocks.length - 1];
      // A wrapped list item goes on in the next line.
      if (paragraph.length === 0 && last?.kind === "list" && /^\s+\S/.test(line)) last.items[last.items.length - 1] += ` ${line.trim()}`;
      else paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

/** `code`, **bold** and *italic* inside a line. */
export function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = parts.length;
    if (match[1] !== undefined) parts.push(<code key={key} className="rounded-[3px] bg-surface-2 px-1 py-px font-mono text-[0.92em] text-text-primary">{match[1]}</code>);
    else if (match[2] !== undefined) parts.push(<strong key={key} className="font-semibold text-text-primary">{match[2]}</strong>);
    else parts.push(<em key={key}>{match[3]}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-text-secondary">
      {parseBlocks(text).map((block, i) => {
        if (block.kind === "heading") {
          return (
            <h4 key={i} className="text-[13px] font-semibold text-text-primary">
              {inline(block.text)}
            </h4>
          );
        }
        if (block.kind === "code") {
          return (
            <pre key={i} className="overflow-x-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-text-primary">
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={i} className={block.ordered ? "flex list-decimal flex-col gap-1 pl-5" : "flex list-disc flex-col gap-1 pl-5"}>
              {block.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </List>
          );
        }
        return <p key={i}>{inline(block.text)}</p>;
      })}
    </div>
  );
}
