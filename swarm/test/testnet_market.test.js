// test/testnet_market.test.js v1.0 - pins the network-free plan behind `npm run testnet:market`.
// Exercises scripts/market_plan.mjs (no NEAR, no keys): the same deterministic rounds, winners and
// Beta reputations that the on-chain replay will submit. Locks the P1 acceptance criteria.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkers, planRounds, betaMean, priceMultiplier, mulberry32 } from '../scripts/market_plan.mjs';

describe('plan del mercado vivo en testnet (sin red)', () => {
  const workers = loadWorkers();
  const plan = planRounds(workers);

  it('selecciona 5 cerebros reales con su tasa LOCKED real, de mayor a menor', () => {
    expect(workers.length).toBe(5);
    expect(workers.map((w) => w.index)).toEqual([1, 2, 3, 4, 5]);
    for (const w of workers) {
      expect(w.alias).toMatch(/^worker-\d+$/);
      expect(w.runs).toBeGreaterThanOrEqual(200); // top-20 por volumen: tasa bien muestreada
      expect(w.locked_rate).toBeGreaterThanOrEqual(0);
    }
    const rates = workers.map((w) => w.locked_rate);
    expect([...rates]).toEqual([...rates].sort((a, b) => b - a)); // orden descendente
    expect(workers[0].locked_rate).toBeGreaterThan(workers[4].locked_rate); // hay divergencia real
  });

  it('>=6 rondas, cada una con >=3 pujas selladas y un ganador que es el mas barato', () => {
    expect(plan.rounds.length).toBeGreaterThanOrEqual(6);
    for (const r of plan.rounds) {
      expect(r.bidders.length).toBeGreaterThanOrEqual(3);
      const min = Math.min(...r.bidders.map((b) => b.price));
      const winBid = r.bidders.find((b) => b.index === r.winner);
      expect(winBid.price).toBe(min);
    }
  });

  it('mezcla Settled/Refunded (unas se liquidan, otras se reembolsan)', () => {
    expect(plan.settled_count).toBeGreaterThanOrEqual(1);
    expect(plan.refunded_count).toBeGreaterThanOrEqual(1);
    expect(plan.settled_count + plan.refunded_count).toBe(plan.rounds.length);
  });

  it('las reputaciones Beta divergen: el fiable se abarata, el que falla se encarece', () => {
    const best = plan.reputations.find((r) => r.index === 1); // mayor tasa real
    const others = plan.reputations.filter((r) => r.index !== 1);
    expect(best.mean).toBeGreaterThan(Math.max(...others.map((o) => o.mean)));
    expect(best.price_multiplier).toBeLessThan(Math.min(...others.map((o) => o.price_multiplier)));
    for (const r of plan.reputations) {
      expect(betaMean(r)).toBeCloseTo(r.mean, 12);
      expect(priceMultiplier(r)).toBeCloseTo(r.price_multiplier, 12);
      expect(r.price_multiplier).toBeGreaterThanOrEqual(1); // fallar nunca abarata
    }
  });

  it('es determinista: misma semilla -> mismo plan byte a byte', () => {
    const a = planRounds(workers);
    const b = planRounds(workers, { seed: 479 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('npm run market:plan escribe un preview sin red que coincide con el plan', () => {
    const dir = join(__dirname, '..');
    execFileSync('node', ['scripts/market_plan_emit.mjs'], { cwd: dir, encoding: 'utf8' });
    const art = JSON.parse(readFileSync(join(dir, 'out', 'market_plan.json'), 'utf8'));
    expect(art.kind).toBe('market_plan_preview');
    expect(art.seed).toBe(479);
    expect(art.rounds).toEqual(plan.rounds);
    expect(art.reputations).toEqual(plan.reputations);
    expect(art.settled_count).toBe(plan.settled_count);
    expect(art.refunded_count).toBe(plan.refunded_count);
  });

  it('mulberry32 es reproducible y acotado en [0,1)', () => {
    const r = mulberry32(479);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(479)()).toBe(mulberry32(479)());
  });
});
