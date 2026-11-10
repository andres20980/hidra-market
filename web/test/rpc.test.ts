// rpc.test.ts v0.2 — modo en vivo con las vistas reales del contrato (list_tasks + get_reputation, fetch mockeado)
import { describe, expect, it, vi } from 'vitest';
import { callView, loadLive, taskToRound, buildStats, toSim, RawTask, YOCTO_PER_NEAR } from '../src/rpc';

const enc = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const bytes = (o: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(o)));

function mockRpc(payloads: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const m = body.params.method_name as string;
    const args = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.params.args_base64), (c) => c.charCodeAt(0))));
    const p = payloads[m];
    if (p === undefined) return { ok: true, json: async () => ({ error: { cause: 'unknown method' } }) };
    return { ok: true, json: async () => ({ result: { result: bytes(typeof p === 'function' ? p(args) : p) } }) };
  }) as unknown as typeof fetch;
}

const task = (over: Partial<RawTask>): RawTask => ({
  id: 't1', publisher: 'pub.testnet', verifier: 'ver.testnet', reward: '2000000000000000000000000', // 2 NEAR en yocto
  state: 'Settled', commit_end: 10, reveal_end: 20,
  commitments: [{ worker: 'w1.testnet', hash: 'YWJj' }, { worker: 'w2.testnet', hash: 'ZGVm' }],
  bids: [{ worker: 'w1.testnet', price: 5 * YOCTO_PER_NEAR }],
  winner: 'w1.testnet', result_hash: 'h', ...over,
});

describe('modo en vivo RPC (vistas reales del contrato)', () => {
  it('callView decodifica result.result y envía args_base64', async () => {
    const f = mockRpc({ list_tasks: [] });
    vi.stubGlobal('fetch', f);
    const out = await callView<RawTask[]>('https://rpc.testnet.near.org', 'm.testnet', 'list_tasks', { from: 0, limit: 100 });
    expect(out).toEqual([]);
    const call = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const body = JSON.parse(String((call[1] as RequestInit).body));
    expect(body.params.account_id).toBe('m.testnet');
    expect(body.params.args_base64).toBe(enc({ from: 0, limit: 100 }));
    vi.unstubAllGlobals();
  });

  it('taskToRound mapea Task del contrato al formato del fixture (yocto→NEAR)', () => {
    const r = taskToRound(task({}), 0);
    expect(r.status).toBe('closed');
    expect(r.verified).toBe(true);
    expect(r.paid).toBe(true);
    expect(r.winner).toBe('w1.testnet');
    expect(r.closePrice).toBe(5);
    expect(r.bids).toHaveLength(2);
    expect(r.bids[0]).toMatchObject({ worker: 'w1.testnet', commit: 'YWJj', reveal: 5, revealed: true });
    expect(r.bids[1]).toMatchObject({ worker: 'w2.testnet', revealed: false, reveal: undefined });
  });

  it('taskToRound: Refunded → refunded y no verificado; Open → open', () => {
    expect(taskToRound(task({ state: 'Refunded', winner: null }), 1).status).toBe('refunded');
    expect(taskToRound(task({ state: 'Refunded', winner: null }), 1).verified).toBe(false);
    expect(taskToRound(task({ state: 'Open', winner: null, bids: [] }), 2).status).toBe('open');
  });

  it('buildStats deriva mercado vs round-robin de los rewards (yocto)', () => {
    const s = buildStats([task({}), task({ id: 't2', state: 'Refunded', winner: null })]);
    expect(s.verifiedResults).toBe(1);
    expect(s.totalSpent).toBe(2);
    expect(s.marketCostPerVerified).toBe(2);
    expect(s.roundRobinCostPerVerified).toBe(4); // 2 tareas cerradas/refundidas × 2 NEAR / 1 verificado
  });

  it('loadLive usa list_tasks + get_reputation y tolera reputación fallida', async () => {
    vi.stubGlobal('fetch', mockRpc({
      list_tasks: [task({})],
      get_reputation: (args: Record<string, unknown>) => (args.account === 'w1.testnet' ? ['3', '1', '0.75'] : ['1', '2', '0.333']),
    }));
    const sim = await loadLive('m.testnet');
    expect(sim.rounds).toHaveLength(1);
    expect(sim.rounds[0].closePrice).toBe(5);
    const w1 = sim.workers.find((w) => w.id === 'w1.testnet')!;
    expect(w1.alpha).toBe(3);
    expect(w1.beta).toBe(1);
    expect(w1.earned).toBe(2);
    expect(w1.done).toBe(1);
    const w2 = sim.workers.find((w) => w.id === 'w2.testnet')!;
    expect(w2.alpha).toBe(1);
    expect(sim.stats.verifiedResults).toBe(1);
    expect(sim.meta.mode).toContain('m.testnet');
    vi.unstubAllGlobals();
  });

  it('toSim compone Sim completo desde tasks y reputaciones', () => {
    const sim = toSim([task({})], { 'w1.testnet': ['3', '1', '0.75'] }, 'm.testnet', 'https://rpc.testnet.near.org');
    expect(sim.workers).toHaveLength(2);
    expect(sim.stats.marketCostPerVerified).toBe(2);
  });

  it('loadLive exige contract', async () => {
    await expect(loadLive('')).rejects.toThrow('contract');
  });
});
