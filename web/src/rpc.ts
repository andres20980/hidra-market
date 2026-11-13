// rpc.ts v0.6 — modo en vivo contra las vistas REALES del contrato (producto/contract/src/lib.rs)
// Vistas usadas: list_tasks(from: u64, limit: u64) -> Vec<Task>; get_reputation(account) -> (alpha, beta, media) como strings
// Fuente RPC: docs.near.org/api/rpc (query call_function, args_base64, result.result = bytes JSON)
// Public endpoint: FastNEAR testnet (rpc.testnet.near.org is deprecated and answers 429; docs.near.org/api/rpc/providers)
import { Round, Sim, Worker } from './sim';

export const DEFAULT_RPC = 'https://test.rpc.fastnear.com';
export const DEMO_CONTRACT = 'market.hidra-mkt-221016.testnet'; // deployed contract on testnet (producto/docs/TESTNET_DEPLOY.md)
export const YOCTO_PER_NEAR = 1e24;
export const TASKS_LIMIT = 100;
export const REPUTATION_LIMIT = 60;

export interface RawCommitment { worker: string; hash: string } // Vec<u8> → base64 en JSON
export interface RawBid { worker: string; price: number } // bid price u64 in milliNEAR (RULES.md section 2)
export interface RawTask {
  id: string; publisher: string; verifier: string;
  reward: string; // NearToken serializado como string de yoctoNEAR
  state: 'Open' | 'Closed' | 'Settled' | 'Refunded';
  commit_end: number; reveal_end: number;
  commitments: RawCommitment[]; bids: RawBid[];
  winner: string | null; result_hash: string | null;
}

export async function callView<T>(
  rpc: string, contract: string, method: string, args: Record<string, unknown> = {},
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const body = {
        jsonrpc: '2.0', id: 'hidra-web', method: 'query',
        params: {
          request_type: 'call_function', finality: 'final',
          account_id: contract, method_name: method,
          args_base64: btoa(unescape(encodeURIComponent(JSON.stringify(args)))),
        },
      };
      const res = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        let msg = "";
        if (res.status === 400) msg = "rejected (HTTP 400) - contract id";
        else if (res.status === 503) msg = "down (HTTP 503)";
        else msg = "error (HTTP " + res.status + ")";
        throw new Error(`RPC ${rpc} (method ${method}) ${msg}`);
      }
      const json = (await res.json()) as { error?: unknown; result?: { result?: number[]; error?: string } };
      if (json.error) throw new Error(`RPC error in ${method} (contract ${contract}) - ${JSON.stringify(json.error).slice(0, 200)}`);
      const rerr = json.result?.error;
      if (rerr) if (rerr.includes("does not exist while viewing")) throw new Error(`RPC error in ${method} (contract ${contract}) - contract does not exist`); else throw new Error(`RPC error in ${method} (contract ${contract}) - ${rerr}`);
      const bytes = json.result?.result;
      if (!bytes) throw new Error(`RPC no result in ${method}`);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
    } catch (e: any) {
      lastError = e;
      if (e.name === 'AbortError') continue;
      throw e;
    }
  }
  throw new Error(`RPC timeout after 3 attempts: ${lastError?.message}`);
}

const YOCTO_BIG = BigInt('1000000000000000000000000'); // 1e24 exacto
export const near = (yocto: string | number): number => {
  if (typeof yocto === 'string') { // reward llega como string: conversión exacta con BigInt
    const y = BigInt(yocto);
    // build the exact decimal string, then parse once: 1e23 yocto -> "0.1" -> 0.1 (no float division error)
    const frac = (y % YOCTO_BIG).toString().padStart(24, '0').replace(/0+$/, '');
    return Number(`${y / YOCTO_BIG}${frac ? `.${frac}` : ''}`);
  }
  return Math.round(yocto / 1e18) / 1e6; // price (u64) llega como number JSON: 6 decimales bastan para mostrar
};

// Bid prices are u64 milliNEAR (a u64 cannot hold a useful yoctoNEAR amount); rewards are yoctoNEAR strings.
export const MILLINEAR_PER_NEAR = 1000;
export const bidNear = (price: number): number => price / MILLINEAR_PER_NEAR;

export function taskToRound(t: RawTask, idx: number): Round {
  const bidByWorker = new Map(t.bids.map((b) => [b.worker, b]));
  const seen = new Set<string>();
  const bids = t.commitments.map((c) => {
    seen.add(c.worker);
    const b = bidByWorker.get(c.worker);
    return { worker: c.worker, commit: c.hash, reveal: b?.price !== undefined ? bidNear(b.price) : undefined, revealed: b !== undefined };
  });
  for (const b of t.bids) {
    if (!seen.has(b.worker)) bids.push({ worker: b.worker, commit: '', reveal: bidNear(b.price), revealed: true });
  }
  const winBid = t.winner ? t.bids.find((b) => b.worker === t.winner) : undefined;
  const settled = t.state === 'Settled';
  return {
    id: idx + 1, task: t.id, publisher: t.publisher,
    status: t.state === 'Open' ? 'open' : t.state === 'Refunded' ? 'refunded' : 'closed',
    bids, winner: t.winner ?? null,
    closePrice: winBid ? bidNear(winBid.price) : null, payment: settled ? near(t.reward) : 0,
    verified: settled, paid: settled, // attest(ok) paga el reward y deja state=Settled (RULES.md R12)
  };
}

export function workerIds(tasks: RawTask[]): string[] {
  const ids = new Set<string>();
  for (const t of tasks) {
    for (const c of t.commitments) ids.add(c.worker);
    for (const b of t.bids) ids.add(b.worker);
    if (t.winner) ids.add(t.winner);
  }
  return [...ids];
}

export function buildWorkers(tasks: RawTask[], reputations: Record<string, [string, string, string]>): Worker[] {
  return workerIds(tasks).slice(0, REPUTATION_LIMIT).map((id) => {
    const rep = reputations[id];
    let earned = 0, done = 0, failed = 0;
    for (const t of tasks) {
      if (t.winner !== id) continue;
      if (t.state === 'Settled') { earned += near(t.reward); done += 1; }
      else failed += 1;
    }
    return { id, alpha: rep ? Number(rep[0]) : 1, beta: rep ? Number(rep[1]) : 1, earned, done, failed };
  });
}

export function buildStats(tasks: RawTask[]): Sim['stats'] {
  const settled = tasks.filter((t) => t.state === 'Settled');
  const verified = settled.length;
  const spent = settled.reduce((s, t) => s + near(t.reward), 0);
  const rrSpent = tasks.filter((t) => t.state !== 'Open').reduce((s, t) => s + near(t.reward), 0);
  return {
    marketCostPerVerified: verified > 0 ? spent / verified : 0,
    roundRobinCostPerVerified: verified > 0 ? rrSpent / verified : 0,
    verifiedResults: verified,
    totalSpent: spent,
  };
}

export function toSim(
  tasks: RawTask[], reputations: Record<string, [string, string, string]>, contract: string, rpc: string,
): Sim {
  return {
    meta: { seed: 0, generatedAt: new Date().toISOString(), currency: 'NEAR', mode: `live · ${contract} @ ${rpc}` },
    rounds: tasks.map(taskToRound),
    workers: buildWorkers(tasks, reputations),
    stats: buildStats(tasks),
  };
}

export async function loadLive(contract: string, rpc: string = DEFAULT_RPC): Promise<Sim> {
  if (!contract) throw new Error('missing ?contract=<account.testnet>');
  try {
    const tasks = await callView<RawTask[]>(rpc, contract, 'list_tasks', { from: 0, limit: TASKS_LIMIT });
    const reps = await Promise.all(workerIds(tasks).slice(0, REPUTATION_LIMIT).map(async (id) => {
      try {
        return [id, await callView<[string, string, string]>(rpc, contract, 'get_reputation', { account: id })] as const;
      } catch (e) {
        console.error(`Reputation fetch failed for ${id}:`, e);
        return null;
      }
    }));
    const reputations: Record<string, [string, string, string]> = {};
    for (const rep of reps) {
      if (rep) reputations[rep[0]] = rep[1];
    }
    return toSim(tasks, reputations, contract, rpc);
  } catch (e) {
    throw new Error(`Live mode error: ${e instanceof Error ? e.message : String(e)}. Check that contract '${contract}' is deployed on testnet.`);
  }
}
