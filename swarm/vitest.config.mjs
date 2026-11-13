// vitest.config.mjs v1.1
// VITE_CACHE_DIR moves the vitest results cache out of node_modules when it is read-only (jailed runs).
import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
  // v1.1: deterministic single-file runs. reproduce_checks.py --no-regen and the
  // artifact-regenerating tests (multiseed_ci.py) touch the same out/*.json, so
  // vitest's default parallel file execution made `npm test` flaky (1 of 2 runs).
  fileParallelism: false,
  sequence: { concurrent: false },
});
