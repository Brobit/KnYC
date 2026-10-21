import { z } from "zod";

// Rules shared by every stored format (design/03-data-model.md):
// stable short string IDs, ISO dates, code referenced by unit IDs, a schemaVersion per file.

export const isoDate = z.iso.datetime({ offset: true });

/** Short, stable identifier: "s07", "chk-s07-2", "backend-standard". */
export const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes only");

/**
 * A piece of code, by path and optional symbol path — never by line number:
 * "src/users/users.service.ts" or "src/users/users.service.ts#UsersService.create".
 */
export const unitId = z.string().regex(/^[^#\s]+(#[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*)?$/, "path or path#Symbol.member");

export const trackId = z.enum(["frontend", "backend", "database", "deployment", "full"]);
export type TrackId = z.infer<typeof trackId>;

export const languageId = z.enum(["typescript", "javascript", "python", "go", "csharp", "html", "css"]);
export type LanguageId = z.infer<typeof languageId>;

export const providerType = z.enum(["anthropic", "openai", "google", "ollama", "claude-cli", "codex-cli"]);

export const modelRef = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
});
export type ModelRef = z.infer<typeof modelRef>;
