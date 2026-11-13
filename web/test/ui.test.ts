// ui.test.ts v1.1 — stable hooks (data-testid) and the light/dark toggle in the toolbar
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, renderToolbar } from '../src/render';
import { sandboxBadge } from '../src/sandbox';
import { Sim } from '../src/sim';

const sim = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/sim.sample.json', import.meta.url)), 'utf8')) as Sim;

describe('stable UI hooks', () => {
  it('exposes the headline, the rounds and the workers tables', () => {
    const html = render(sim);
    expect(html).toContain('data-testid="cost-per-result"');
    expect(html).toContain('data-testid="rounds"');
    expect(html).toContain('data-testid="workers"');
  });
  it('renders a theme toggle button in the toolbar', () => {
    const t = renderToolbar(sim);
    expect(t).toContain('id="theme-toggle"');
    expect(t).toContain('aria-label="Cambiar entre tema claro y oscuro"');
  });
  it('links the live demo to the deployed contract on testnet', () => {
    const t = renderToolbar(sim);
    expect(t).toContain('data-testid="live-demo-link"');
    expect(t).toContain('href="?contract=market.hidra-mkt-221016.testnet"');
  });

  it('marks the sandbox badge with a stable hook', () => {
    expect(sandboxBadge({ network: 'near-sandbox', market: 'm.test.near', winner: 'w0.test.near', state: 'Settled' }))
      .toContain('data-testid="sandbox-badge"');
  });
  it('keeps the theme wired in the entry point', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(main).toContain("getElementById('theme-toggle')");
    expect(main).toContain("localStorage.setItem('theme', next)");
  });
});

describe('live mode refresh (datos en vivo del contrato)', () => {
  it('repaints the intro with the update time on every poll, not only the tables', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(main).toContain('renderIntro(x, new Date().toLocaleTimeString()) + render(x)');
  });
});
