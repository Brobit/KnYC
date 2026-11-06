import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb } from "./client.js";

// Applies the migrations in drizzle/ to DATABASE_FILE (dev.db by default): `npm run db:migrate`.
migrate(createDb(), { migrationsFolder: "drizzle" });
console.log("migrations applied");
