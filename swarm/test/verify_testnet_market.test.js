// test/verify_testnet_market.test.js v1.0 - network-free checks of the testnet proof comparator.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { txList, compareRound, compareReputation } from '../scripts/verify_testnet_market.mjs';

const proof = JSON.parse(readFileSync(new URL('../out/testnet_market.json', import.meta.url), 'utf8'));
const okStatuses = (r) => Object.fromEntries(txList(r).map((t) => [t.hash, 'ok']));
const asChain = (r) => ({ state: r.state, winner: r.winner, reward: r.reward_yocto });

describe('verificador de la prueba testnet (sin red)', () => {
  it('la prueba tiene 8 rondas, 3 Settled y 5 Refunded, y cada una lista sus tx', () => {
    expect(proof.rounds.length).toBe(8);
    expect(proof.rounds.filter((r) => r.state === 'Settled').length).toBe(3);
    expect(proof.rounds.filter((r) => r.state === 'Refunded').length).toBe(5);
    const n = proof.rounds.reduce((s, r) => s + txList(r).length, 0);
    expect(n).toBe(98);
  });
  it('cadena idéntica al JSON → sin discrepancias', () => {
    for (const r of proof.rounds) expect(compareRound(r, asChain(r), okStatuses(r))).toEqual([]);
    for (const rep of proof.reputations) expect(compareReputation(rep, [rep.alpha, rep.beta, rep.mean])).toEqual([]);
  });
  it('reputación crecida (append-only) → sin discrepancias; snapshot es cota inferior', () => {
    const rep = proof.reputations[0];
    expect(compareReputation(rep, [String(Number(rep.alpha) + 2), String(Number(rep.beta) + 1), '0'])).toEqual([]);
  });
  it('detecta estado, ganador, tx fallida y tarea ausente', () => {
    const r = proof.rounds[0];
    const st = okStatuses(r);
    st[r.txs.post_task] = 'failed';
    const issues = compareRound(r, { ...asChain(r), state: 'Settled', winner: 'x.testnet' }, st);
    expect(issues.some((i) => i.startsWith('state'))).toBe(true);
    expect(issues.some((i) => i.startsWith('winner'))).toBe(true);
    expect(issues.some((i) => i.includes('post_task') && i.endsWith('failed'))).toBe(true);
    expect(compareRound(r, null, okStatuses(r))[0]).toMatch(/not found/);
  });
  it('detecta regresión de reputación (cadena por debajo del snapshot) y vista ausente', () => {
    const rep = proof.reputations[0];
    expect(compareReputation(rep, [String(Number(rep.alpha) - 1), rep.beta, '0'])).toHaveLength(1);
    expect(compareReputation(rep, [rep.alpha, String(Number(rep.beta) - 1), '0'])).toHaveLength(1);
    expect(compareReputation(rep, undefined)).toHaveLength(1);
  });
});
