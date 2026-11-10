// vite.config.ts v0.2
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  publicDir: 'fixtures',
  test: { environment: 'node', include: ['test/**/*.test.ts'] }
});
