// live_testnet.test.ts v1.0 - the live mode parses the REAL views of market.hidra-mkt-221016.testnet
// 1) replay: exact payloads recorded from the public RPC (fixtures/testnet_live_views.json), no network
// 2) live: same assertions against the RPC itself, only when LIVE_CONTRACT is set (e.g. LIVE_CONTRACT=market.<acct>.testnet)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callView, DEFAULT_RPC, loadLive, type RawTask } from '../src/rpc';
import type { Sim } from '../src/sim';

const views = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/testnet_live_views.json', import.meta.url)), 'utf8')) as {
  contract: string;
  list_tasks: RawTask[];
  get_reputation: Record<string, [string, string, string]>;
  get_round: Record<string, { state: string; winner: string | null }>;
};
const SETTLED = 'round-1794486561599';
const WORKER = 'worker-1.hidra-mkt-221016.testnet';
const enc = (v: unknown) => ({ result: { result: [...new TextEncoder().encode(JSON.stringify(v))] } });

const checkSim = (sim: Sim) => {
  const round = sim.rounds.find((r) => r.task === SETTLED);
  expect(round).toBeDefined();
  expect(round?.winner).toBe(WORKER);
  expect(round?.verified).toBe(true);
  expect(round?.paid).toBe(true);
  expect(round?.payment).toBe(0.1);
  expect(round?.closePrice).toBe(0.08);
  const worker = sim.workers.find((w) => w.id === WORKER);
  expect(worker?.alpha).toBeGreaterThanOrEqual(2);
  expect(worker?.beta).toBeGreaterThanOrEqual(1);
  expect(sim.stats.verifiedResults).toBeGreaterThanOrEqual(1);
};

describe('live mode on the deployed testnet contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses the recorded list_tasks / get_reputation / get_round payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const p = JSON.parse(init.body).params;
      const args = JSON.parse(atob(p.args_base64));
      if (p.method_name === 'list_tasks') return { ok: true, json: async () => enc(views.list_tasks) };
      if (p.method_name === 'get_reputation') return { ok: true, json: async () => enc(views.get_reputation[args.account] ?? ['1', '1', '0.5']) };
      if (p.method_name === 'get_round') return { ok: true, json: async () => enc(views.get_round[args.task_id] ?? null) };
      return { ok: false, status: 400 };
    }));
    const sim = await loadLive(views.contract, 'http://rpc.local');
    checkSim(sim);
    expect(sim.workers.find((w) => w.id === WORKER)?.alpha).toBe(2);
    expect(sim.workers.find((w) => w.id === WORKER)?.beta).toBe(1);
    const round = await callView<{ state: string; winner: string }>('http://rpc.local', views.contract, 'get_round', { task_id: SETTLED });
    expect(round.state).toBe('Settled');
    expect(round.winner).toBe(WORKER);
  });

  it.skipIf(!process.env.LIVE_CONTRACT)('parses the same views from the public RPC', async () => {
    const contract = process.env.LIVE_CONTRACT as string;
    const rpc = process.env.LIVE_RPC ?? DEFAULT_RPC;
    checkSim(await loadLive(contract, rpc));
    const round = await callView<{ state: string; winner: string }>(rpc, contract, 'get_round', { task_id: SETTLED });
    expect(round.state).toBe('Settled');
  }, 30000);
});
