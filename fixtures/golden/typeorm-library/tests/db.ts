import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DataSource } from "typeorm";
import { createDataSource } from "../src/db/data-source.js";

/** A data source on a fresh SQLite file with every migration applied. */
export async function freshDb(): Promise<DataSource> {
  const ds = await createDataSource(join(mkdtempSync(join(tmpdir(), "library-")), "test.db")).initialize();
  await ds.runMigrations();
  return ds;
}
