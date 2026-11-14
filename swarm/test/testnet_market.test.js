// test/testnet_market.test.js v1.1 - pins the network-free plan behind `npm run testnet:market`.
// Exercises scripts/market_plan.mjs (no NEAR, no keys): the same deterministic rounds, winners and
// Beta reputations that the on-chain replay will submit. Locks the P1 acceptance criteria.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkers, planRounds, betaMean, priceMultiplier, mulberry32, proofFileName } from '../scripts/market_plan.mjs';

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

  it('selecciona el siguiente tramo de 5 cerebros sin reutilizar las cuentas del primer tramo', () => {
    const next = loadWorkers(join(__dirname, '..'), { offset: 5 });
    const nextPlan = planRounds(next);
    expect(next.map((w) => w.index)).toEqual([6, 7, 8, 9, 10]);
    expect(next.map((w) => w.alias).some((alias) => workers.some((w) => w.alias === alias))).toBe(false);
    expect(next.every((w) => w.runs >= 200)).toBe(true);
    expect(nextPlan.rounds.every((r) => r.bidders.every((b) => b.index >= 6 && b.index <= 10))).toBe(true);
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

  it('el out/market_plan.json commiteado no esta obsoleto: byte-identico a una emision fresca', () => {
    const dir = join(__dirname, '..');
    const committed = readFileSync(join(dir, 'out', 'market_plan.json')); // raw bytes del repo
    const tmp = join(tmpdir(), `market_plan_${process.pid}.json`);
    execFileSync('node', ['scripts/market_plan_emit.mjs', tmp], { cwd: dir, encoding: 'utf8' });
    const fresh = readFileSync(tmp);
    unlinkSync(tmp);
    expect(fresh.equals(committed)).toBe(true); // artefacto generado desfasado = test en rojo, sin drift silencioso
    const art = JSON.parse(fresh.toString('utf8'));
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

  it('un segundo tramo (MARKET_RUN != c) escribe un fichero distinto y nunca pisa el proof congelado', () => {
    expect(proofFileName('c')).toBe('testnet_market.json');
    expect(proofFileName('d')).toBe('testnet_market-d.json');
    expect(proofFileName('d')).not.toBe(proofFileName('c'));
  });

  it('el segundo tramo continua las reputaciones del primero (cap-safe, solo gas) y las separa mas', () => {
    const extra = planRounds(workers, { rounds: 16 });
    expect(extra.rounds.length).toBe(16); // mas rondas sobre los mismos cerebros financiados

    // arranca desde las alpha/beta que el primer tramo dejo on-chain
    const initialRep = Object.fromEntries(plan.reputations.map((r) => [r.index, { alpha: r.alpha, beta: r.beta }]));
    const cont = planRounds(workers, { rounds: 8, initialRep });
    const total = (reps) => reps.reduce((s, r) => s + r.alpha + r.beta, 0);
    // cada ronda incrementa exactamente un ganador -> el total de observaciones crece justo en `rounds`
    expect(total(cont.reputations)).toBe(total(plan.reputations) + 8);
    for (const r of cont.reputations) {
      const base = plan.reputations.find((p) => p.index === r.index);
      expect(r.alpha).toBeGreaterThanOrEqual(base.alpha); // continua, nunca reinicia a Beta(1,1)
      expect(r.beta).toBeGreaterThanOrEqual(base.beta);
    }
    // el fiable (index 1) sigue siendo el de mayor media tras continuar
    const best = cont.reputations.find((r) => r.index === 1);
    const others = cont.reputations.filter((r) => r.index !== 1);
    expect(best.mean).toBeGreaterThan(Math.max(...others.map((o) => o.mean)));
  });

  it('el tramo vivo arranca de la reputacion ACTUAL on-chain (tupla con u64 en texto) y es determinista', () => {
    // forma real de get_reputation tras el primer tramo + 1 ronda diag (append-only): alpha/beta llegan como texto
    const chain = { 1: { alpha: '9', beta: '6' }, 2: { alpha: '1', beta: '2' }, 3: { alpha: '1', beta: '2' }, 4: { alpha: '1', beta: '3' }, 5: { alpha: '1', beta: '2' } };
    const a = planRounds(workers, { rounds: 6, initialRep: chain });
    const b = planRounds(workers, { rounds: 6, initialRep: chain });
    expect(a).toEqual(b);
    expect(a.rounds.map((r) => `${r.winner}:${r.state}`)).toEqual(['1:Refunded', '5:Refunded', '1:Refunded', '1:Refunded', '1:Settled', '1:Settled']);
    expect(a.reputations.map((r) => [r.index, r.alpha, r.beta])).toEqual([[1, 11, 9], [2, 1, 2], [3, 1, 2], [4, 1, 3], [5, 1, 3]]);
    expect(a.settled_count).toBeGreaterThanOrEqual(1);
    expect(a.refunded_count).toBeGreaterThanOrEqual(1);
  });
});
