// vite.config.ts v0.4
// publicDir is public/: `make demo` writes the fresh sim.json and sandbox_round.json there (fixtures/ is for tests only).
// VITE_CACHE_DIR moves vite/vitest caches out of node_modules when it is read-only (jailed runs).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  publicDir: 'public',
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  test: { environment: 'node', include: ['test/**/*.test.ts'],
    // smoke.test.ts is a playwright run (@playwright/test), not a vitest unit test
    exclude: ['**/node_modules/**', '**/dist/**', 'test/smoke.test.ts'] }
});
