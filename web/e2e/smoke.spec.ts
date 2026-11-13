// e2e/smoke.spec.ts v1.1 — browser smoke over the built local route (no network): headline, rounds, badge, theme, demo replay
import { test, expect } from '@playwright/test';

test.describe('web smoke (built dist)', () => {
  test('headline, rounds, workers and sandbox badge are rendered', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Hidra Market/);
    const headline = page.locator('[data-testid="cost-per-result"]');
    await expect(headline).toBeVisible({ timeout: 20_000 });
    await expect(headline).toContainText('Coste por resultado verificado');
    await expect(page.locator('[data-testid="rounds"] tbody tr').first()).toBeVisible();
    await expect(page.locator('[data-testid="workers"] tbody tr').first()).toBeVisible();
    await expect(page.locator('[data-testid="sandbox-badge"]')).toContainText('near-sandbox');
  });

  test('dark mode toggle switches the theme', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('#theme-toggle');
    await expect(toggle).toBeVisible();
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await toggle.click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
  });

  test('replay toggle inicia y pausa la simulación con datos del demo', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('#replay-toggle');
    await expect(toggle).toBeVisible();
    // el replay arranca solo tras 1,5 s; esperar a que haya al menos una ronda renderizada
    await expect(page.locator('[data-testid="rounds"] tbody tr').first()).toBeVisible({ timeout: 10_000 });
    const status = page.locator('#replay-status');
    await expect(status).toBeVisible();
    // pausar
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // reiniciar: vuelve a reproducir
    await page.locator('#replay-restart').click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('cambio de velocidad activa el botón seleccionado', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="rounds"] tbody tr').first()).toBeVisible({ timeout: 10_000 });
    const speedBtn2 = page.locator('.btn-speed[data-speed="2"]');
    await expect(speedBtn2).toBeVisible();
    await speedBtn2.click();
    await expect(speedBtn2).toHaveClass(/active/);
    await expect(speedBtn2).toHaveAttribute('aria-pressed', 'true');
    const speedBtn1 = page.locator('.btn-speed[data-speed="1"]');
    await expect(speedBtn1).toHaveAttribute('aria-pressed', 'false');
  });
});
