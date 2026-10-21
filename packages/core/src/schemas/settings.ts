import { z } from "zod";
import { modelRef, providerType } from "./common.ts";

export const provider = z.object({
  id: z.string().min(1),
  type: providerType,
  label: z.string().min(1),
  baseUrl: z.url().optional(),
  /** Keychain entry name. The key itself is never stored in settings. */
  keyRef: z.string().optional(),
});
export type Provider = z.infer<typeof provider>;

export const settings = z.object({
  schemaVersion: z.literal(1),
  uiLanguage: z.string().default("en"),
  theme: z
    .object({
      name: z.enum(["focus", "sage-camel"]),
      mode: z.enum(["system", "light", "dark"]),
    })
    .default({ name: "focus", mode: "system" }),
  /** Serialized dockview layout (design 04). */
  layout: z.unknown().optional(),
  confirmCostEstimate: z.boolean().default(true),
  providers: z.array(provider).default([]),
  roles: z.object({
    summaries: modelRef,
    planning: modelRef,
    lessons: modelRef,
  }),
  editor: z
    .object({
      fontSize: z.number().int().min(8).max(32),
      tabSize: z.number().int().min(1).max(8),
      vimMode: z.boolean(),
    })
    .default({ fontSize: 13, tabSize: 2, vimMode: false }),
  runChecksIn: z.enum(["local", "docker"]).default("local"),
});
export type Settings = z.infer<typeof settings>;
