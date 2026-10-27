const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** A short slug from a number: 1 → "aab", the same number always giving the same slug. */
export function slugFor(n: number, length = 3): string {
  let rest = n;
  let slug = "";
  for (let i = 0; i < length || rest > 0; i++) {
    slug = ALPHABET[rest % ALPHABET.length] + slug;
    rest = Math.floor(rest / ALPHABET.length);
  }
  return slug;
}

/** Slugs that would shadow the API's own routes. */
export const RESERVED_SLUGS = new Set(["links", "health", "r"]);
