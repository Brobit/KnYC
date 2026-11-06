import { createDataSource } from "./data-source.js";

// Applies the migrations to DATABASE_FILE (dev.db by default): `npm run db:migrate`.
const ds = await createDataSource().initialize();
const applied = await ds.runMigrations();
console.log(`${applied.length} migration(s) applied`);
await ds.destroy();
