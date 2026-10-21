import { z } from "zod";
import { check } from "./check.ts";
import { lesson } from "./lesson.ts";
import { learningPath } from "./learning-path.ts";
import { progress } from "./progress.ts";
import { project } from "./project.ts";
import { settings } from "./settings.ts";

/** Every JSON file KnYC writes, with its current schema (design/03-data-model.md). */
export const documents = {
  settings,
  project,
  path: learningPath,
  check,
  lesson,
  progress,
} as const;

export type DocumentKind = keyof typeof documents;
export type DocumentOf<K extends DocumentKind> = z.infer<(typeof documents)[K]>;

export const CURRENT_VERSION: Record<DocumentKind, number> = {
  settings: 1,
  project: 1,
  path: 1,
  check: 1,
  lesson: 1,
  progress: 1,
};

/**
 * Upgrades a raw document from `version` to `version + 1`.
 * Register one per version bump, e.g. `migrations.path[1] = (raw) => ({ ...raw, schemaVersion: 2, … })`.
 */
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
export const migrations: Record<DocumentKind, Record<number, Migration>> = {
  settings: {},
  project: {},
  path: {},
  check: {},
  lesson: {},
  progress: {},
};

export class DocumentError extends Error {
  readonly kind: DocumentKind;
  readonly issues: string[];

  constructor(kind: DocumentKind, message: string, issues: string[] = []) {
    super(issues.length > 0 ? `${message}:\n- ${issues.join("\n- ")}` : message);
    this.name = "DocumentError";
    this.kind = kind;
    this.issues = issues;
  }
}

/** Human-readable issue list, also used to send precise errors back to the AI. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/**
 * Reads a stored document: upgrades it to the current schemaVersion, then validates it.
 * Files written by a newer KnYC are refused rather than silently misread.
 */
export function loadDocument<K extends DocumentKind>(kind: K, raw: unknown): DocumentOf<K> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DocumentError(kind, `${kind} must be a JSON object`);
  }
  let doc = raw as Record<string, unknown>;
  const current = CURRENT_VERSION[kind];
  let version = doc.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new DocumentError(kind, `${kind} has no valid schemaVersion`);
  }
  if (version > current) {
    throw new DocumentError(kind, `${kind} uses schemaVersion ${version}, newer than this KnYC (${current}); update KnYC`);
  }
  while (version < current) {
    const migrate = migrations[kind][version];
    if (!migrate) throw new DocumentError(kind, `no migration for ${kind} from schemaVersion ${version}`);
    doc = migrate(doc);
    version += 1;
  }

  const result = documents[kind].safeParse(doc);
  if (!result.success) throw new DocumentError(kind, `invalid ${kind}`, formatIssues(result.error));
  return result.data as DocumentOf<K>;
}

/**
 * JSON Schema of what a producer (e.g. the AI) must send — the *input* side, before defaults.
 * Cross-field rules written with refine/superRefine can't be expressed in JSON Schema; they are
 * still enforced when the result is parsed.
 */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}
