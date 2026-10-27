export interface AppConfig {
  port: number;
  /** Requests that change tasks must send it in the x-api-key header. */
  apiKey: string;
  maxTitleLength: number;
}

/** The injection token of the configuration provider. */
export const APP_CONFIG = "APP_CONFIG";

function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    port: numberFrom(env.PORT, 3000),
    apiKey: env.API_KEY || "dev-key",
    maxTitleLength: numberFrom(env.MAX_TITLE_LENGTH, 80),
  };
}
