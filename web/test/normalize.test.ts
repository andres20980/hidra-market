// normalize.test.ts v1.0 — normalizer must read both sim formats and produce renderable data
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeSim } from '../src/normalize';
import { headline } from '../src/sim';
import { render } from '../src/render';
import { renderToolbar } from '../src/render';

const load = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8'));

describe('normalizeSim', () => {
  it('reads the swarm/out format (commitments + reveals + adjusted_prices)', () => {
    const sim = normalizeSim(load('sim.swarm.sample.json'));
    expect(sim.rounds).toHaveLength(10);
    const settled = sim.rounds.find((r) => r.verified && r.paid)!;
    const raw = load('sim.swarm.sample.json').rounds.find((x: any) => x.round === settled.id);
    expect(settled.id).toBe(raw.round);
    expect(settled.bids.length).toBe(Object.keys(raw.commitments).length);
    expect(settled.bids.every((b) => b.revealed && typeof b.reveal === 'number')).toBe(true);
    expect(settled.closePrice).toBe(raw.adjusted_prices[raw.winner]);
    expect(settled.verified).toBe(true);
    expect(settled.paid).toBe(true);
    expect(sim.workers).toHaveLength(20);
    expect(sim.stats.marketCostPerVerified).toBe(100);
    expect(sim.stats.roundRobinCostPerVerified).toBe(1000);
  });

  it('reads the web fixture format (bids inline)', () => {
    const sim = normalizeSim(load('sim.sample.json'));
    expect(sim.rounds.length).toBeGreaterThan(0);
    expect(sim.rounds.every((r) => Array.isArray(r.bids))).toBe(true);
    expect(sim.stats.marketCostPerVerified).toBe(0.42);
    expect(sim.stats.roundRobinCostPerVerified).toBe(1.13);
  });

  it('does not infer round-robin cost from market spend without a baseline', () => {
    const sim = normalizeSim({
      rounds: [{ round: 1, verified: true, closePrice: 1, bids: [] }],
      stats: { marketCostPerVerified: 1, verifiedResults: 1, totalSpent: 1 },
    });
    expect(sim.stats.roundRobinCostPerVerified).toBe(0);
  });

  it('keeps a round open when it has no winner', () => {
    const sim = normalizeSim({ rounds: [{ round: 1, state: 'open', commitments: {}, reveals: {} }] });
    expect(sim.rounds[0].winner).toBeNull();
    expect(sim.rounds[0].closePrice).toBeNull();
    expect(sim.rounds[0].status).toBe('open');
  });

  it('maps a refunded swarm round as not paid and not open', () => {
    const sim = normalizeSim({ rounds: [{ round: 7, state: 'refunded', winner: 'w', payment: 0, attested: false, commitments: { w: { commitment: 'c', price: 5 } }, reveals: {}, adjusted_prices: { w: 5 } }] });
    expect(sim.rounds[0].status).toBe('refunded');
    expect(sim.rounds[0].paid).toBe(false);
    expect(sim.rounds[0].verified).toBe(false);
    expect(render(sim)).toContain('refunded');
  });

  it('renders rounds and headline for the real swarm snapshot', () => {
    const html = render(normalizeSim(load('sim.swarm.sample.json')));
    expect(html).toContain('data-round="2"');
    expect(html).toContain('earned');
    expect(html).toContain('worker-');
    const h = headline(normalizeSim(load('sim.swarm.sample.json')));
    expect(h).toContain('market 100.00 NEAR vs round-robin 1000.00 NEAR');
    expect(renderToolbar(normalizeSim(load('sim.swarm.sample.json')), 2)).toContain('2');
  });
});

  it("handles round with empty bids array with id property", () => {
    const sim = normalizeSim({ rounds: [{ round: 1, state: "open", commitments: {}, reveals: {}, bids: [], winner: null, closePrice: null }] });
    expect(sim.rounds[0].bids).toEqual([]);
    expect(sim.rounds[0].winner).toBeNull();
    expect(sim.rounds[0].closePrice).toBeNull();
    expect(render(sim)).toContain('data-round="1"')
  });
