import { File, FileCode, FileCog, FileImage, FileJson, FileSymlink, FileText, Folder, FolderOpen, type LucideIcon } from "lucide-react";
import type { TreeEntry } from "@/lib/workspace-fs";

const BY_EXTENSION: Record<string, LucideIcon> = {
  json: FileJson,
  md: FileText,
  mdx: FileText,
  txt: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  webp: FileImage,
  ico: FileImage,
  yml: FileCog,
  yaml: FileCog,
  toml: FileCog,
  lock: FileCog,
  env: FileCog,
};

const CODE = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "go", "cs", "py", "rs", "java", "rb", "php", "vue", "svelte", "html", "css", "scss", "sql", "sh"];

/** Dotfiles and build files read as configuration. */
const CONFIG_NAMES = /^(\.gitignore|\.npmrc|\.nvmrc|\.editorconfig|\.prettierrc.*|\.eslintrc.*|dockerfile|makefile|\.env.*)$/i;

export function fileIcon(entry: Pick<TreeEntry, "kind">, name: string, expanded = false): LucideIcon {
  if (entry.kind === "dir") return expanded ? FolderOpen : Folder;
  if (entry.kind === "symlink") return FileSymlink;
  if (CONFIG_NAMES.test(name)) return FileCog;
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (CODE.includes(extension)) return FileCode;
  return BY_EXTENSION[extension] ?? File;
}
