// What an AI call's failure means for the learner, one message per AiError kind (#56). Used by
// Settings' test call now, and by the analysis and lesson screens later.
import type { TFunction } from "i18next";
import { AiError } from "@knyc/core";

export function aiErrorMessage(t: TFunction, error: unknown): string {
  const kind = error instanceof AiError ? error.kind : "provider";
  const detail = error instanceof Error ? error.message : String(error);
  return t(`ai.errors.${kind}`, { detail });
}
