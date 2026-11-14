// test/zero_price_proof.test.js v1.0 - static pins for scripts/prove_zero_price_testnet.mjs (no network).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, '..', 'scripts', 'prove_zero_price_testnet.mjs'), 'utf8');
const libRs = readFileSync(join(here, '..', '..', 'contract', 'src', 'lib.rs'), 'utf8');
const constOf = (name) => script.match(new RegExp(`const ${name} = ([^;]+);`))[1];

describe('prove_zero_price_testnet.mjs', () => {
  it('expects the exact require message the contract source raises', () => {
    const msg = JSON.parse(constOf('REQUIRE_MESSAGE'));
    expect(libRs).toContain(`require!(price > 0, "${msg}")`);
  });
  it('attacks with price 0 and lets an honest positive bid win', () => {
    expect(Number(constOf('ZERO_PRICE'))).toBe(0);
    expect(Number(constOf('HONEST_PRICE'))).toBeGreaterThan(0);
  });
  it('--check exits before any transaction is signed', () => {
    const exitAt = script.indexOf('if (CHECK) process.exit');
    expect(exitAt).toBeGreaterThan(0);
    for (const tx of ['callFunctionRaw', 'await call(']) {
      expect(script.indexOf(tx, script.indexOf('// preflight'))).toBeGreaterThan(exitAt);
    }
  });
  it('refuses to run unless the live code is the local price>0 wasm', () => {
    expect(script).toMatch(/if \(!pre\.live_is_local \|\| !srcHasGuard \|\| !liveHasGuard\)/);
  });
});
