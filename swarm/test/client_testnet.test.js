// client_testnet.test.js v1.0
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';

const run = (env) =>
  spawnSync('node', ['scripts/client_testnet.mjs'], {
    cwd: __dirname + '/..',
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });

describe('client_testnet guards', () => {
  it('sale con rc=2 y BLOQUEO si falta .env', () => {
    const r = run({});
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/BLOQUEO/);
  });

  it('rechaza cuentas que no son *testnet', () => {
    const r = run({ NEAR_ACCOUNT_ID: 'foo.near', NEAR_PRIVATE_KEY: 'ed25519:x', NEAR_CONTRACT_ID: 'm.testnet' });
    expect(r.status).not.toBe(0);
  });
});
