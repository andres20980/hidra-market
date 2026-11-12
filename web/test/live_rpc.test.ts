// live_rpc.test.ts v1.0
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadLive } from '../src/rpc';

const Y = '1000000000000000000000000';
const tasks = [
  { id: 't1', publisher: 'p.testnet', verifier: 'v.testnet', reward: Y, state: 'Settled', commit_end: 1, reveal_end: 2,
    commitments: [{ worker: 'a.testnet', hash: 'h1' }, { worker: 'b.testnet', hash: 'h2' }],
    bids: [{ worker: 'a.testnet', price: 3e23 }, { worker: 'b.testnet', price: 5e23 }], winner: 'a.testnet', result_hash: 'r' },
  { id: 't2', publisher: 'p.testnet', verifier: 'v.testnet', reward: Y, state: 'Open', commit_end: 1, reveal_end: 2,
    commitments: [{ worker: 'b.testnet', hash: 'h3' }], bids: [], winner: null, result_hash: null },
];
const enc = (v: unknown) => ({ result: { result: [...new TextEncoder().encode(JSON.stringify(v))] } });

describe('loadLive (fetch mock)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds a Sim from list_tasks + get_reputation views', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      const p = JSON.parse(init.body).params;
      const out = p.method_name === 'list_tasks' ? tasks : ['4', '2', '0'];
      return { ok: true, json: async () => enc(out) };
    }));
    const sim = await loadLive('m.testnet', 'http://rpc.local');
    expect(sim.rounds).toHaveLength(2);
    expect(sim.rounds[0].winner).toBe('a.testnet');
    expect(sim.rounds[0].closePrice).toBe(0.3);
    expect(sim.rounds[0].payment).toBe(1);
    expect(sim.rounds[1].status).toBe('open');
    expect(sim.workers.find((w) => w.id === 'a.testnet')?.alpha).toBe(4);
    expect(sim.workers.find((w) => w.id === 'a.testnet')?.earned).toBe(1);
    expect(sim.stats.verifiedResults).toBe(1);
    expect(sim.stats.totalSpent).toBe(1);
    expect(sim.stats.marketCostPerVerified).toBe(1);
  });

  it('rejects without contract and wraps RPC errors', async () => {
    await expect(loadLive('')).rejects.toThrow(/contract/);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(loadLive('m.testnet', 'http://x')).rejects.toThrow(/modo en vivo.*500/);
  });
});
