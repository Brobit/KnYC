export interface Config {
  port: number;
  baseUrl: string;
  codeLength: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  return {
    port,
    baseUrl: env.BASE_URL ?? `http://localhost:${port}`,
    codeLength: Number(env.CODE_LENGTH ?? 6),
  };
}
