// The AI providers Settings knows how to set up, and the settings changes they make.
import type { Provider, Settings } from "@knyc/core/schemas";

export type ProviderType = Provider["type"];
export type RoleId = keyof Settings["roles"];
export const ROLES: RoleId[] = ["summaries", "planning", "lessons"];

/** Providers reached with an API key. Their id is their type: one key per provider. */
export const API_PROVIDERS = [
  { type: "anthropic", label: "Anthropic", placeholder: "sk-ant-…" },
  { type: "openai", label: "OpenAI", placeholder: "sk-…" },
  { type: "google", label: "Google Gemini", placeholder: "AIza…" },
] as const satisfies { type: ProviderType; label: string; placeholder: string }[];

export const OLLAMA_DEFAULT_URL = "http://localhost:11434";

/** Keychain entry name of a provider's key (see keychain.rs for the allowed characters). */
export const keyRefFor = (type: ProviderType) => `${type}-api-key`;

/** Model names offered for a role; any other name can still be typed. */
export const MODEL_SUGGESTIONS: Partial<Record<ProviderType, string[]>> = {
  "claude-cli": ["haiku", "sonnet", "opus"],
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
};

/** Adds the provider, or replaces the one with the same id. */
export function withProvider(settings: Settings, provider: Provider): Settings {
  const others = settings.providers.filter((p) => p.id !== provider.id);
  const index = settings.providers.findIndex((p) => p.id === provider.id);
  const providers = index < 0 ? [...others, provider] : [...others.slice(0, index), provider, ...others.slice(index)];
  return { ...settings, providers };
}

/** Roles that used the provider keep pointing at it; Settings shows them as needing a new choice. */
export function withoutProvider(settings: Settings, id: string): Settings {
  return { ...settings, providers: settings.providers.filter((p) => p.id !== id) };
}
