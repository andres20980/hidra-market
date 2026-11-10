// test/swarmformat.test.ts v1.0 — contract test: the real swarm/out/sim.json must normalize
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeSim } from '../src/normalize';
import { headline } from '../src/sim';
import { render } from '../src/render';

const simPath = fileURLToPath(new URL('../../swarm/out/sim.json', import.meta.url));
const raw = JSON.parse(readFileSync(simPath, 'utf8'));
const sim = normalizeSim(raw);

describe('swarm/out/sim.json contract', () => {
  it('normalizes every round with commit→reveal bids', () => {
    expect(sim.rounds).toHaveLength(raw.rounds.length);
    for (const [i, r] of sim.rounds.entries()) {
      expect(r.bids.length).toBe(Object.keys(raw.rounds[i].commitments ?? {}).length);
      for (const b of r.bids) expect(typeof b.commit).toBe('string');
    }
  });

  it('keeps winner, close price and verification flags per round', () => {
    for (const [i, r] of sim.rounds.entries()) {
      const src = raw.rounds[i];
      if (src.winner) {
        expect(r.winner).toBe(src.winner);
        expect(r.bids.map((b) => b.worker)).toContain(src.winner);
        expect(r.closePrice).toBe(src.adjusted_prices[src.winner]);
      }
      expect(r.verified).toBe(!!src.attest);
      expect(r.paid).toBe((src.payment ?? 0) > 0);
    }
  });

  it('carries the headline metrics of the market vs round-robin', () => {
    expect(sim.stats.marketCostPerVerified).toBe(raw.metrics.mercado.coste_por_verificado);
    expect(sim.stats.roundRobinCostPerVerified).toBe(raw.metrics.round_robin.coste_por_verificado);
    expect(headline(sim)).toContain('round-robin');
  });

  it('maps reputation so workers can be ranked', () => {
    const ids = sim.workers.map((w) => w.id);
    expect(ids.length).toBe(Object.keys(raw.reputation).length);
    for (const id of Object.keys(raw.reputation)) {
      const w = sim.workers.find((x) => x.id === id)!;
      expect(w.alpha).toBe(raw.reputation[id].alpha);
      expect(w.earned).toBe(raw.spent_by_agent[id] ?? 0);
    }
  });

  it('renders rounds, workers and headline from the real simulation', () => {
    const html = render(sim);
    for (const r of sim.rounds) expect(html).toContain(`data-round="${r.id}"`);
    for (const w of sim.workers) expect(html).toContain(`data-worker="${w.id}"`);
    expect(html).toContain(headline(sim));
  });
});
