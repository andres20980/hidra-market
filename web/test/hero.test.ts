// hero.test.ts v1.0 — pins the product hero: pitch, the two comparison bars and the live testnet link
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderHero } from '../src/render';
import { DEMO_CONTRACT } from '../src/rpc';
import { Sim } from '../src/sim';

const sim = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/sim.sample.json', import.meta.url)), 'utf8')) as Sim;

describe('product hero', () => {
  const html = renderHero(sim);

  it('shows the name and the one-line pitch', () => {
    expect(html).toContain('data-testid="hero"');
    expect(html).toContain('Hidra Market');
    expect(html).toContain('get paid only when a verifier attests the work');
  });

  it('renders the two comparison bars (market vs round-robin) with a factor chip', () => {
    expect(html).toContain('data-testid="hero-bars"');
    const bars = html.match(/class="bar-fill/g) ?? [];
    expect(bars).toHaveLength(2);
    expect(html).toContain('bar-fill good');
    expect(html).toContain('bar-fill muted');
    expect(html).toContain('factor-chip');
    expect(html).toMatch(/\d+&#215; cheaper/);
  });

  it('links Live on NEAR testnet to the deployed contract on the explorer', () => {
    expect(html).toContain('data-testid="hero-live-link"');
    expect(html).toContain(`https://testnet.nearblocks.io/address/${DEMO_CONTRACT}`);
    expect(DEMO_CONTRACT.endsWith('.testnet')).toBe(true);
  });

  it('offers a Watch the replay call to action and trust badges', () => {
    expect(html).toContain('data-testid="watch-replay"');
    expect(html).toContain('href="#replay"');
    expect(html).toContain('No LLM calls');
    expect(html).toContain('reproducible: make demo');
  });
});
