// test/zero_price_compat.test.js v1.0 - every bid the swarm emits is strictly positive.
// A zero-price bid nullifies the Beta reputation weighting (0 * (alpha+beta)/alpha = 0 always wins),
// so the contract may enforce `price > 0` in reveal_bid. This pins that the off-chain plan and the
// on-chain replay already published never relied on a zero bid: the guard changes no figure.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkers, planRounds } from '../scripts/market_plan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const collectPrices = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((v) => collectPrices(v, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'price' && (typeof v === 'number' || typeof v === 'string')) out.push(Number(v));
      else collectPrices(v, out);
    }
  }
  return out;
};

describe('compatibilidad con require(price > 0) en reveal_bid', () => {
  it('el plan determinista nunca puja 0 (200 semillas, rep. extrema incluida)', () => {
    const workers = loadWorkers();
    const extreme = Object.fromEntries(workers.map((w) => [w.index, { alpha: 1000, beta: 1 }]));
    for (let seed = 1; seed <= 200; seed++) {
      for (const initialRep of [null, extreme]) {
        const prices = collectPrices(planRounds(workers, { seed, initialRep }));
        expect(prices.length).toBeGreaterThan(0);
        expect(Math.min(...prices)).toBeGreaterThanOrEqual(1);
        expect(prices.every(Number.isInteger)).toBe(true);
      }
    }
  });

  it.each(['out/testnet_market.json', 'out/testnet_market-f.json', 'out/testnet_live_proof.json'])(
    'las pujas reveladas on-chain en %s son todas > 0',
    (file) => {
      const prices = collectPrices(JSON.parse(readFileSync(join(root, file), 'utf8')));
      expect(prices.length).toBeGreaterThan(0);
      expect(Math.min(...prices)).toBeGreaterThan(0);
    },
  );
});
