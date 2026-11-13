// playwright.config.ts v1.0 — browser smoke config: serves the built dist (web/dist) on 127.0.0.1:4173
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off' },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
