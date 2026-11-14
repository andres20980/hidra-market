// e2e/overflow.spec.ts v1.1 — no horizontal overflow at 375px and 1280px, testnet rounds visible and labelled
import { test, expect } from '@playwright/test';

for (const width of [375, 1280]) {
  test(`no horizontal overflow at ${width}px; testnet proof is labelled real`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.locator('#testnet-rounds')).toBeVisible();
    await expect(page.locator('#testnet-rounds-title')).toContainText('real testnet');
    await expect(page.locator('#testnet-rounds-note')).toContainText('Not the simulated replay');
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      win: window.innerWidth,
    }));
    expect(m.doc).toBeLessThanOrEqual(m.win);
    expect(m.body).toBeLessThanOrEqual(m.win);
  });
}
