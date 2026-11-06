import { defineConfig } from "vitest/config";

// Each test migrates its own SQLite file (a few hundred ms).
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
