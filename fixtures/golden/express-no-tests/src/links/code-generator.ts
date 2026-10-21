const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/l/I

export type Random = () => number;

export function generateCode(length: number, random: Random = Math.random): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return code;
}

// Custom aliases: 3–32 letters, digits, "-" or "_".
export function isValidAlias(alias: string): boolean {
  return /^[A-Za-z0-9_-]{3,32}$/.test(alias);
}

// Paths the app already uses can't become short codes.
export const RESERVED_CODES = new Set(["api", "health"]);
