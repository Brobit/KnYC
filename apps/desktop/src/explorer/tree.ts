// The Explorer's tree as plain data: folders are loaded one level at a time into `children`,
// and the visible rows are what is loaded and expanded.
import type { TreeEntry } from "@/lib/workspace-fs";

export interface TreeNode extends TreeEntry {
  name: string;
}

export interface TreeRowData extends TreeNode {
  depth: number;
  expanded: boolean;
}

/** Loaded folders: "" is the workspace root. */
export type Children = ReadonlyMap<string, TreeNode[]>;

export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Folders first, then files, each in natural order ("file2" before "file10"). */
export function sortEntries(entries: TreeEntry[]): TreeNode[] {
  const isDir = (e: TreeEntry) => e.kind === "dir";
  return entries
    .map((e) => ({ ...e, name: nameOf(e.path) }))
    .sort((a, b) => Number(isDir(b)) - Number(isDir(a)) || collator.compare(a.name, b.name));
}

export function visibleRows(children: Children, expanded: ReadonlySet<string>): TreeRowData[] {
  const rows: TreeRowData[] = [];
  const walk = (dir: string, depth: number) => {
    for (const node of children.get(dir) ?? []) {
      const isOpen = node.kind === "dir" && expanded.has(node.path);
      rows.push({ ...node, depth, expanded: isOpen });
      if (isOpen) walk(node.path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** Loaded folders a batch of changes may have touched: each path's parent, and the path itself if it was a loaded folder. */
export function foldersToReload(changed: string[], children: Children): string[] {
  const dirs = new Set<string>();
  for (const path of changed) {
    if (children.has(parentOf(path))) dirs.add(parentOf(path));
    if (children.has(path)) dirs.add(path);
  }
  return [...dirs];
}

/** Drops loaded folders that no longer exist under `dir` after reloading it. */
export function pruneChildren(children: Map<string, TreeNode[]>, dir: string, fresh: TreeNode[]): void {
  children.set(dir, fresh);
  const keep = new Set(fresh.filter((n) => n.kind === "dir").map((n) => n.path));
  for (const path of [...children.keys()]) {
    // The root is its own parent ("" → ""), so `dir` itself is skipped explicitly.
    if (path !== dir && parentOf(path) === dir && !keep.has(path)) {
      for (const nested of [...children.keys()]) if (nested === path || nested.startsWith(`${path}/`)) children.delete(nested);
    }
  }
}

/** `path` after `from` was renamed to `to` (itself or something inside it), or unchanged. */
export function movedPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

export const isInside = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`);

export type NameProblem = "empty" | "separator" | "dots" | "taken";

/** Checks a file or folder name typed in the Explorer; null when it can be used. */
export function nameProblem(name: string, siblings: TreeNode[], current?: string): NameProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (/[\\/]/.test(trimmed)) return "separator";
  if (trimmed === "." || trimmed === "..") return "dots";
  if (trimmed !== current && siblings.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) return "taken";
  return null;
}
