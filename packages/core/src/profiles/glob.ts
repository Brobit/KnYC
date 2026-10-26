// The globs of track rules (#85): `*` and `?` within a path segment, `**` across segments, `{a,b}`
// alternatives. Enough for profile rules; no dependency (core stays browser-safe and small).

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const known = cache.get(glob);
  if (known) return known;
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      // "**/" matches zero or more folders; a trailing "**" matches everything below.
      const slash = glob[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      // Wildcards work inside an option too ("{vitest.config.*,tsconfig*.json}").
      const options = glob
        .slice(i + 1, end)
        .split(",")
        .map((o) => o.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"));
      source += `(?:${options.join("|")})`;
      i = end;
    } else source += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  const re = new RegExp(`^${source}$`);
  cache.set(glob, re);
  return re;
}

export const matchesGlob = (path: string, glob: string) => globToRegExp(glob).test(path);
