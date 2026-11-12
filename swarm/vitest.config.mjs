// vitest.config.mjs v1.0
// VITE_CACHE_DIR moves the vitest results cache out of node_modules when it is read-only (jailed runs).
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
});
