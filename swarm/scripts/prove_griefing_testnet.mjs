// prove_griefing_testnet.mjs v1.0 - on-chain proof of the storage-griefing fix on market.<root>.
// Drives ONE fresh single-bidder round to Closed with worker-1 as winner, then attempts submit_result with
// an oversized result_hash (MAX_RESULT_HASH_LEN+1 bytes). The contract must REJECT it with the require message
// "Result hash length out of bounds" (the tx lands with status.Failure). Then it submits a valid result and
// attests ok=true so the escrow settles and nothing is left stuck. Credentials ONLY from .env; no key printed.
// Public proof: out/testnet_security.json. Usage: node --env-file=.env scripts/prove_griefing_testnet.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, nearToYocto, teraToGas } from "near-api-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");
mkdirSync(OUT, { recursive: true });

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`BLOQUEO: missing ${k} in .env`); process.exit(2); }
  return v;
};
const root = need("NEAR_ACCOUNT_ID");
const rootKey = need("NEAR_PRIVATE_KEY");
const market = need("NEAR_CONTRACT_ID");
const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
if (!root.endsWith(".testnet")) { console.error("BLOQUEO: testnet only"); process.exit(2); }

const MAX_RESULT_HASH_LEN = 128;
const REWARD = "0.05";
const COMMIT_LEN = 120;
const REVEAL_LEN = 120;
const GAS = teraToGas("50");
const verifierId = `verifier.${root}`;
const workerId = `worker-1.${root}`;
const nearblocks = (h) => `https://testnet.nearblocks.io/txns/${h}`;

const provider = new JsonRpcProvider({ url: rpcUrl });
const rootAccount = new Account(root, provider, rootKey);

const rpc = async (method, params) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 429 && body?.error?.code !== -429) return body;
    if (attempt >= 5) throw new Error("RPC rate-limited");
    await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
  }
};
const view = async (methodName, args) => {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: market,
    method_name: methodName, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  if (!r.result) throw new Error(`view ${methodName}: ${JSON.stringify(r.error ?? r).slice(0, 200)}`);
  return JSON.parse(Buffer.from(r.result.result).toString("utf8"));
};
const viewUntil = async (methodName, args, done, ms = 60000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await view(methodName, args);
    if (done(v) || Date.now() - t0 > ms) return v;
    await new Promise((ok) => setTimeout(ok, 2500));
  }
};
const finalHeight = async () => (await rpc("block", { finality: "final" })).result.header.height;
const waitHeight = async (target) => {
  for (;;) {
    const h = await finalHeight();
    if (h >= target) return h;
    await new Promise((ok) => setTimeout(ok, Math.min(10000, Math.max(2000, (target - h) * 600))));
  }
};
const call = async (account, methodName, args, deposit = 0n) => {
  const res = await account.callFunctionRaw({ contractId: market, methodName, args, deposit, gas: GAS });
  if (res.status?.Failure) throw new Error(`${methodName} failed: ${JSON.stringify(res.status.Failure).slice(0, 300)}`);
  return res.transaction.hash;
};
// commitment = sha256(price:u64 BE || salt:u32 BE || accountId) — must match the contract.
const commitmentOf = (price, salt, accountId) => {
  const payload = Buffer.alloc(12 + Buffer.byteLength(accountId));
  payload.writeBigUInt64BE(BigInt(price), 0);
  payload.writeUInt32BE(salt >>> 0, 8);
  payload.write(accountId, 12, "utf8");
  return Array.from(createHash("sha256").update(payload).digest());
};

const verifierKeyFile = join(OUT, "verifier.testnet.key");
const workerKeyFile = join(OUT, "worker-1.testnet.key");
for (const f of [verifierKeyFile, workerKeyFile]) {
  if (!existsSync(f)) { console.error(`BLOQUEO: ${f} missing; run npm run testnet:market first`); process.exit(2); }
}
const verifier = new Account(verifierId, provider, readFileSync(verifierKeyFile, "utf8").trim());
const worker = new Account(workerId, provider, readFileSync(workerKeyFile, "utf8").trim());

const taskId = `griefing-proof-${await finalHeight()}-${root}`;
const price = 1;
const salt = 7;
const proof = { network: "testnet", rpc: rpcUrl, market, task_id: taskId, worker: workerId,
  guard: "require!(!result_hash.is_empty() && result_hash.len() <= MAX_RESULT_HASH_LEN)",
  max_result_hash_len: MAX_RESULT_HASH_LEN, txs: {} };

// 1. fresh round, worker-1 the only bidder -> it wins
try { await call(worker, "register_worker", {}); } catch (e) { if (!String(e.message).includes("already registered")) throw e; }
proof.txs.post_task = await call(rootAccount, "post_task", { id: taskId, verifier: verifierId, commit_len: COMMIT_LEN, reveal_len: REVEAL_LEN }, BigInt(nearToYocto(REWARD)));
proof.txs.commit_bid = await call(worker, "commit_bid", { task_id: taskId, commitment: commitmentOf(price, salt, workerId) });
const open = await viewUntil("get_round", { task_id: taskId }, (x) => x?.state === "Open");
await waitHeight(open.commit_end);
proof.txs.reveal_bid = await call(worker, "reveal_bid", { task_id: taskId, price, salt });
await waitHeight(open.reveal_end);
proof.txs.close_round = await call(rootAccount, "close_round", { task_id: taskId });
const closed = await viewUntil("get_round", { task_id: taskId }, (x) => x?.state === "Closed" || x?.winner);
proof.winner = closed.winner;
if (closed.winner !== workerId) throw new Error(`unexpected winner ${closed.winner}`);

// 2. ATTACK: oversized result_hash must be rejected by the require.
// near-api-js THROWS on a contract panic (the tx lands with a failed receipt), so capture from the throw.
const oversized = "a".repeat(MAX_RESULT_HASH_LEN + 1);
let attackTx = null, failStr = "", rejected = false;
try {
  const attack = await worker.callFunctionRaw({ contractId: market, methodName: "submit_result",
    args: { task_id: taskId, result_hash: oversized }, deposit: 0n, gas: GAS });
  // if it did NOT throw, the guard failed to reject
  attackTx = attack.transaction?.hash ?? null;
  failStr = JSON.stringify(attack.status ?? {});
} catch (e) {
  // near-api-js attaches the failed outcome under e.transactionResult (FinalExecutionOutcome)
  const tr = e?.transactionResult;
  attackTx = tr?.transaction?.hash ?? tr?.transaction_outcome?.id ?? e?.transaction?.hash ?? null;
  failStr = JSON.stringify(tr?.status ?? {}) + " " + String(e?.message ?? e);
  rejected = failStr.includes("Result hash length out of bounds");
}
proof.attack = {
  result_hash_len: oversized.length,
  tx: attackTx,
  nearblocks: attackTx ? nearblocks(attackTx) : null,
  rejected,
  require_message: "Result hash length out of bounds",
  failure_excerpt: failStr.slice(0, 260),
};
// confirm the oversized hash never touched storage
const afterAttack = await view("get_task", { task_id: taskId });
proof.attack.result_hash_still_none = afterAttack?.result_hash == null;

// 3. settle cleanly with a valid (bounded) result so no escrow is left stuck
const validHash = createHash("sha256").update(`griefing-proof ${taskId}`).digest("hex");
proof.txs.submit_result_valid = await call(worker, "submit_result", { task_id: taskId, result_hash: validHash });
proof.txs.attest = await call(verifier, "attest", { task_id: taskId, ok: true });
const settled = await viewUntil("get_task", { task_id: taskId }, (t) => t?.state === "Settled" || t?.state === "Refunded");
proof.final_state = settled?.state;
proof.valid_result_accepted = settled?.result_hash === validHash;

proof.pass = rejected && proof.attack.result_hash_still_none && proof.valid_result_accepted;
writeFileSync(join(OUT, "testnet_security.json"), JSON.stringify(proof, null, 2) + "\n");
console.log(`oversized submit_result rejected=${rejected} (${oversized.length}>${MAX_RESULT_HASH_LEN}) tx=${attackTx}`);
console.log(`valid result accepted, final=${proof.final_state}; PASS=${proof.pass} -> out/testnet_security.json`);
if (!proof.pass) process.exit(1);
