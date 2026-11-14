// hero.test.ts v1.4 — pins the product hero: pitch, the two comparison bars and the live testnet link
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

  it('puts a Live on NEAR testnet button in the first screen', () => {
    expect(html).toContain('data-testid="hero-live-demo"');
    expect(html).toContain(`href="?contract=${DEMO_CONTRACT}"`);
    expect(html).toMatch(/hero-live-demo[^>]*>[\s\S]*?Live on NEAR testnet<\/a>/);
    expect(html.indexOf('hero-live-demo')).toBeLessThan(html.indexOf('watch-replay'));
    expect(html.match(/<h1[ >]/g)?.length).toBe(1);
    expect(html).toMatch(/class="btn btn-primary btn-onchain" data-testid="hero-live-demo"/);
  });

  it('offers a Watch the replay call to action and trust badges', () => {
    expect(html).toContain('data-testid="watch-replay"');
    expect(html).toContain('href="#replay"');
    expect(html).toContain('No LLM calls');
    expect(html).toContain('reproducible: make demo');
  });
});

describe('real headline figure', () => {
  it('leads with the real swarm factor and its per-result costs', () => {
    const html = renderHero(sim);
    expect(html).toContain('10.6&#215;');
    expect(html).toContain('cheaper if escrow had paid our real ledger');
    expect(html).toContain('counterfactual');
    expect(html).toContain('$0.0611');
    expect(html).toContain('$0.0058');
    expect(html.indexOf('hero-big')).toBeLessThan(html.indexOf('bar-row'));
  });

  it('labels the replay scenario as simulated, and as testnet in live mode', () => {
    expect(renderHero(sim)).toMatch(/data-testid="hero-scenario"><span class="tag">simulated<\/span>/);
    expect(renderHero(sim)).toMatch(/<span class="scen-fig">.*vs.*cheaper<\/span><\/span><\/p>/);
    expect(renderHero(sim, true)).toMatch(/<span class="tag">testnet<\/span> Live market/);
  });
});

describe('round lifecycle bar', () => {
  it('lists the five stages in order in the hero', async () => {
    const { renderHero: rh } = await import('../src/render');
    const h = rh(sim);
    const items = [...h.matchAll(/<li data-i="\d"[^>]*>([^<]+)<\/li>/g)].map((m) => m[1]);
    expect(items).toEqual(['Funded', 'Sealed bids', 'Revealed', 'Attested', 'Paid / Refunded']);
    expect(h.indexOf('data-testid="round-stages"')).toBeLessThan(h.indexOf('hero-cta'));
  });
  it('maps replay status lines to the active stage and outcome', async () => {
    const { stageOf } = await import('../src/render');
    expect(stageOf('1/9 · waiting for bids (hidden commits)')).toEqual({ i: 0 });
    expect(stageOf('2/9 · round 1: 4 sealed bids (commit)')).toEqual({ i: 1 });
    expect(stageOf('3/9 · round 1: bids opened (reveal)')).toEqual({ i: 2 });
    expect(stageOf('4/9 · round 1: close 136 NEAR · worker-⁠58 · verified · paid')).toEqual({ i: 4, end: 'paid' });
    expect(stageOf('4/9 · round 2: close 90 NEAR · worker-3 · unverified')).toEqual({ i: 4, end: 'refunded' });
    expect(stageOf('live · hidra-mkt.testnet')).toBeNull();
  });
  it('live view maps the newest on-chain round to a stage', async () => {
    const { stageOfRound } = await import('../src/render');
    const r = (o: object) => ({ id: 1, task: 't', publisher: 'p', status: 'open', bids: [], winner: null, closePrice: null, payment: 0, verified: false, paid: false, ...o }) as Sim['rounds'][number];
    const bid = { worker: 'w', commit: 'c', revealed: false };
    expect(stageOfRound(undefined)).toBeNull();
    expect(stageOfRound(r({}))).toEqual({ i: 0 });
    expect(stageOfRound(r({ bids: [bid] }))).toEqual({ i: 1 });
    expect(stageOfRound(r({ bids: [{ ...bid, revealed: true }] }))).toEqual({ i: 2 });
    expect(stageOfRound(r({ status: 'closed' }))).toEqual({ i: 3 });
    expect(stageOfRound(r({ status: 'closed', paid: true }))).toEqual({ i: 4, end: 'paid' });
    expect(stageOfRound(r({ status: 'refunded' }))).toEqual({ i: 4, end: 'refunded' });
  });
});
