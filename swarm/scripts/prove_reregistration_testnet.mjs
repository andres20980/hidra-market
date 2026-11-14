// prove_reregistration_testnet.mjs v1.0
// On-chain proof (AHORA 5b, adversarial) that a worker with a bad record cannot launder its reputation by
// re-registering: worker-5b holds Beta(1,3) after run f (pays 4x its bid to win), calls register_worker again,
// and the contract must reject it with "Worker already registered" while get_reputation stays identical.
// Only escape is a fresh account (Beta(1,1), x2) = the disclosed Sybil path, bounded per identity by
// cap_per_agent. Offline twin: contract/tests/test_reputation_laundering.rs. Cost: gas of 1 failed tx.
// Credentials only from out/worker-5b.testnet.key (never printed). Output: out/testnet_reregistration.json.
// Usage: node --env-file=.env scripts/prove_reregistration_testnet.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");

export const REQUIRE_MESSAGE = "Worker already registered";

// Exact rational multiplier the reverse auction applies to a bid: (alpha+beta)/alpha.
export const multiplier = ([alpha, beta]) => Number(BigInt(alpha) + BigInt(beta)) / Number(BigInt(alpha));

export const evaluate = ({ before, after, rejected, failure }) => {
  const same = String(before[0]) === String(after[0]) && String(before[1]) === String(after[1]);
  return {
    rejected,
    require_message_seen: String(failure).includes(REQUIRE_MESSAGE),
    reputation_unchanged: same,
    multiplier_before: multiplier(before),
    multiplier_after: multiplier(after),
    fresh_identity_multiplier: multiplier([1, 1]),
    pass: rejected && String(failure).includes(REQUIRE_MESSAGE) && same,
  };
};

const main = async () => {
  const { Account, JsonRpcProvider, teraToGas } = await import("near-api-js");
  const root = process.env.NEAR_ACCOUNT_ID;
  const market = process.env.NEAR_CONTRACT_ID;
  if (!root?.endsWith(".testnet") || !market) { console.error("BLOQUEO: testnet NEAR_ACCOUNT_ID/NEAR_CONTRACT_ID missing"); process.exit(2); }
  const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
  const workerId = `worker-5b.${root}`;
  const keyFile = join(OUT, "worker-5b.testnet.key");
  if (!existsSync(keyFile)) { console.error(`BLOQUEO: ${keyFile} missing`); process.exit(2); }
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const worker = new Account(workerId, provider, readFileSync(keyFile, "utf8").trim());

  const view = async (method_name, args) => {
    const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function",
        finality: "final", account_id: market, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
    const r = await res.json();
    if (!r.result) throw new Error(`view ${method_name}: ${JSON.stringify(r.error ?? r).slice(0, 200)}`);
    return JSON.parse(Buffer.from(r.result.result).toString("utf8"));
  };

  const before = await view("get_reputation", { account: workerId });
  let tx = null, failure = "", rejected = false;
  try {
    const r = await worker.callFunctionRaw({ contractId: market, methodName: "register_worker", args: {}, deposit: 0n, gas: teraToGas("30") });
    tx = r.transaction?.hash ?? null;
    failure = JSON.stringify(r.status ?? {});
    rejected = Boolean(r.status?.Failure);
  } catch (e) {
    const tr = e?.transactionResult;
    tx = tr?.transaction?.hash ?? tr?.transaction_outcome?.id ?? null;
    failure = `${JSON.stringify(tr?.status ?? {})} ${String(e?.message ?? e)}`;
    rejected = true;
  }
  await new Promise((ok) => setTimeout(ok, 3000));
  const after = await view("get_reputation", { account: workerId });
  const verdict = evaluate({ before, after, rejected, failure });
  const proof = { network: "testnet", rpc: rpcUrl, market, worker: workerId, attack: "register_worker re-call to reset Beta",
    tx, nearblocks: tx ? `https://testnet.nearblocks.io/txns/${tx}` : null, reputation_before: before, reputation_after: after,
    require_message: REQUIRE_MESSAGE, failure_excerpt: failure.slice(0, 260), ...verdict };
  writeFileSync(join(OUT, "testnet_reregistration.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(`re-register rejected=${rejected} msg=${verdict.require_message_seen} rep ${before.slice(0, 2)} -> ${after.slice(0, 2)} x${verdict.multiplier_after} tx=${tx} PASS=${verdict.pass}`);
  if (!verdict.pass) process.exit(1);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
