import type { z } from "zod";
import { badRequest } from "./errors.js";

// Parses untrusted input with a Zod schema and turns failures into a 400 with readable details.
export function validate<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    throw badRequest("Invalid request", details);
  }
  return result.data;
}
