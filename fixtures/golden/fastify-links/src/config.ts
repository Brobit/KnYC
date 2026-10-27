export interface Config {
  port: number;
  /** The token write routes expect in "Authorization: Bearer <token>". */
  adminToken: string;
  /** Where short links point to: http://localhost:3000/r/<slug>. */
  baseUrl: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT);
  const resolvedPort = Number.isInteger(port) && port > 0 ? port : 3000;
  return {
    port: resolvedPort,
    adminToken: env.ADMIN_TOKEN || "dev-token",
    baseUrl: (env.BASE_URL || `http://localhost:${resolvedPort}`).replace(/\/$/, ""),
  };
}
