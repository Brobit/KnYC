// The database server a project's checks need (#116). A project on SQLite needs none: its checks
// migrate a fresh file. One on Postgres gets a Postgres container next to each test check
// (knyc-runner `postgres.rs`), its URLs in DATABASE_URL and KNYC_POSTGRES_URL.

import type { Graph } from "../sys/knyc-sys.ts";

export type Database = "postgres";

/** The provider of a Prisma schema's datasource: "sqlite", "postgresql"… */
export function prismaProvider(schema: string): string | undefined {
  const datasource = /datasource\s+\w+\s*\{([^}]*)\}/.exec(schema)?.[1];
  return datasource ? /^\s*provider\s*=\s*"([^"]+)"/m.exec(datasource)?.[1] : undefined;
}

/** Postgres when the project's Prisma schema is on it; `read` reads a file of the project. */
export async function databaseOf(graph: Graph, read: (file: string) => Promise<string>): Promise<Database | undefined> {
  for (const file of graph.files.filter((f) => /(^|\/)schema\.prisma$/.test(f.path))) {
    const provider = prismaProvider(await read(file.path).catch(() => ""));
    if (provider === "postgresql" || provider === "postgres") return "postgres";
  }
  return undefined;
}
