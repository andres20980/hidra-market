// preflight_testnet_tranche.mjs v1.0 - read-only launch check for the AHORA 5(a) second market tranche.
// No keys, no writes on-chain, 0 NEAR: queries view_account, view_access_key_list and get_reputation for
// every worker already recorded in the frozen proof, and reports whether a cap-safe extra tranche can run
// (accounts funded, limited FunctionCall key still scoped to the market, remaining gas allowance, registered).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SWARM = join(HERE, "..");
const OUT = join(SWARM, "out");
const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
const WORKER_METHODS = ["register_worker", "commit_bid", "reveal_bid", "submit_result"];
const MIN_BALANCE_NEAR = 0.05; // headroom for a few rounds of gas (~0.0003 NEAR/tx observed)
const YOCTO = 1e24;

// pure: decide readiness from already-fetched on-chain state (unit-tested offline, no network).
export const evaluateWorker = (
  { account_id, balanceYocto, keys, reputation },
  { market, methods = WORKER_METHODS, minBalanceNear = MIN_BALANCE_NEAR } = {},
) => {
  const issues = [];
  const exists = balanceYocto != null;
  if (!exists) issues.push("account missing");
  const balance_near = exists ? Number(BigInt(balanceYocto)) / YOCTO : 0;
  if (exists && balance_near < minBalanceNear) issues.push(`balance ${balance_near.toFixed(4)} < ${minBalanceNear} NEAR`);
  const fc = keys?.length === 1 ? keys[0]?.access_key?.permission?.FunctionCall : null;
  const key_ok = keys?.length === 1 && fc?.receiver_id === market && JSON.stringify(fc?.method_names) === JSON.stringify(methods);
  if (!key_ok) issues.push(keys?.length !== 1 ? `expected 1 key, found ${keys?.length ?? 0}` : "key not scoped to market methods");
  const allowance_near = fc?.allowance != null ? Number(BigInt(fc.allowance)) / YOCTO : null;
  // get_reputation returns the chain tuple [alpha, beta, mean] (strings) for a registered worker, null otherwise;
  // also accept the {alpha, beta} object shape used inside the frozen proof.
  const [alpha, beta] = Array.isArray(reputation)
    ? reputation
    : reputation && typeof reputation === "object"
      ? [reputation.alpha, reputation.beta]
      : [null, null];
  const registered = alpha != null && beta != null;
  if (!registered) issues.push("not registered on contract");
  return {
    account_id,
    balance_near: Number(balance_near.toFixed(4)),
    allowance_near: allowance_near == null ? null : Number(allowance_near.toFixed(4)),
    key_ok,
    registered,
    reputation: registered ? { alpha: String(alpha), beta: String(beta) } : null,
    ready: issues.length === 0,
    issues,
  };
};

// main (network): only runs when invoked directly, keeps the module importable by the offline test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const proofFile = join(OUT, "testnet_market.json");
  if (!existsSync(proofFile)) {
    console.error("BLOQUEO: out/testnet_market.json missing (run the first tranche first)");
    process.exit(2);
  }
  const proof = JSON.parse(readFileSync(proofFile, "utf8"));
  const market = proof.market;
  const rpc = async (method, params) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status !== 429 && body?.error?.code !== -429) return body;
      if (attempt >= 5) throw new Error(`RPC ${rpcUrl} rate-limited (429)`);
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
    }
  };
  const accountState = async (accountId) =>
    (await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId })).result ?? null;
  const accessKeys = async (accountId) =>
    (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: accountId })).result?.keys ?? [];
  const getReputation = async (account) => {
    const r = await rpc("query", {
      request_type: "call_function",
      finality: "final",
      account_id: market,
      method_name: "get_reputation",
      args_base64: Buffer.from(JSON.stringify({ account })).toString("base64"),
    });
    if (!r.result?.result) return null;
    return JSON.parse(Buffer.from(r.result.result).toString("utf8"));
  };

  const rows = [];
  for (const w of proof.workers) {
    const st = await accountState(w.account_id);
    const row = evaluateWorker(
      {
        account_id: w.account_id,
        balanceYocto: st?.amount ?? null,
        keys: await accessKeys(w.account_id),
        reputation: await getReputation(w.account_id),
      },
      { market },
    );
    rows.push(row);
    console.log(
      `${row.account_id} balance=${row.balance_near} allowance=${row.allowance_near} key_ok=${row.key_ok} reg=${row.registered} ${row.ready ? "READY" : "BLOCKED " + row.issues.join("; ")}`,
    );
  }
  const ready = rows.every((r) => r.ready);
  const out = {
    network: "testnet",
    rpc: rpcUrl,
    market,
    checked_at_proof: "testnet_market.json",
    min_balance_near: MIN_BALANCE_NEAR,
    workers: rows,
    ready,
    ready_count: rows.filter((r) => r.ready).length,
  };
  writeFileSync(join(OUT, "testnet_preflight.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`preflight ${out.ready_count}/${rows.length} ${ready ? "READY to launch the cap-safe tranche" : "BLOCKED"}`);
  process.exit(ready ? 0 : 1);
}
