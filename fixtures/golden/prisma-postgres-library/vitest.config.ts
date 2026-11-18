import { defineConfig } from "vitest/config";

// Each test migrates its own database (about a second).
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
