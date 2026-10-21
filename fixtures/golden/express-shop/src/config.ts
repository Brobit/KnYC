export interface Config {
  port: number;
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  logRequests: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    jwtSecret: env.JWT_SECRET ?? "dev-secret-change-me",
    jwtExpiresInSeconds: Number(env.JWT_EXPIRES_IN ?? 3600),
    logRequests: env.NODE_ENV !== "test" && env.LOG_REQUESTS !== "false",
  };
}
