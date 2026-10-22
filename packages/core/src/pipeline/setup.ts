// Fixes to the provided setup (R_0) so early steps build on their own (design/08, improvement 2).
// They change only setup files such as tsconfig.json, never source code: the last step still
// reproduces the original sources exactly.

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Since TypeScript 6, `types` defaults to [] and Node's types only arrive through another package's
 * types (Express's, say). A first step without that import (`config.ts` reading `process.env`)
 * then fails with "Cannot find name 'process'". When the project installs @types/node and its
 * tsconfig doesn't choose `types` itself, this adds `"types": ["node"]`.
 *
 * Returns the new tsconfig text, or null when nothing should change. Edits the text (comments and
 * formatting stay); a tsconfig that `extends` another is left alone, since its base may list types.
 */
export function withNodeTypes(tsconfig: string, pkg: PackageJson): string | null {
  if (!pkg.dependencies?.["@types/node"] && !pkg.devDependencies?.["@types/node"]) return null;
  if (/"extends"\s*:/.test(tsconfig) || /"types"\s*:/.test(tsconfig)) return null;
  const open = /"compilerOptions"\s*:\s*\{/.exec(tsconfig);
  if (!open) return null;

  const at = open.index + open[0].length;
  const rest = tsconfig.slice(at);
  if (/^\s*\}/.test(rest)) return `${tsconfig.slice(0, at)} "types": ["node"] ${rest.replace(/^\s*/, "")}`;
  const indent = /^\r?\n([ \t]*)/.exec(rest)?.[1] ?? "  ";
  const newline = tsconfig.includes("\r\n") ? "\r\n" : "\n";
  return `${tsconfig.slice(0, at)}${newline}${indent}"types": ["node"],${rest}`;
}
