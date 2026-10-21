import type { NoteInput } from "./note.js";
import { ValidationError } from "../errors.js";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Validates a request body. With `partial`, missing fields are allowed (PATCH).
export function parseNoteInput(body: unknown, maxTitleLength: number, partial = false): Partial<NoteInput> {
  const errors: string[] = [];
  const data = (body ?? {}) as Record<string, unknown>;
  const result: Partial<NoteInput> = {};

  if (data.title !== undefined || !partial) {
    if (typeof data.title !== "string" || data.title.trim() === "") {
      errors.push("title is required");
    } else if (data.title.length > maxTitleLength) {
      errors.push(`title must be at most ${maxTitleLength} characters`);
    } else {
      result.title = data.title.trim();
    }
  }

  if (data.body !== undefined || !partial) {
    if (typeof data.body !== "string") errors.push("body must be a string");
    else result.body = data.body;
  }

  if (data.tags !== undefined) {
    if (!isStringArray(data.tags)) errors.push("tags must be an array of strings");
    else result.tags = [...new Set(data.tags.map((tag) => tag.toLowerCase()))];
  } else if (!partial) {
    result.tags = [];
  }

  if (errors.length > 0) throw new ValidationError(errors);
  return result;
}
