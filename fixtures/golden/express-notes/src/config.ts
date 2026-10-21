export interface Config {
  port: number;
  maxTitleLength: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    maxTitleLength: Number(env.MAX_TITLE_LENGTH ?? 120),
  };
}
