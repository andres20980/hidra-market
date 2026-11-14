// prove_zero_price_testnet.mjs v1.0 - on-chain proof of the zero-price-bid fix (require!(price > 0)) on market.<root>.
// One fresh round, two bidders: worker-1 commits price 0 (the old dominant strategy: score 0 beat any reputation),
// worker-2 commits a positive price. worker-1's reveal_bid must be REJECTED with "Price must be > 0"; worker-2
// reveals, wins, submits and is attested ok=true so the escrow settles. Run ONLY after the price>0 wasm is live.
// --check: read-only preflight (env, keys, live code sha256 vs local wasm), 0 tx. Credentials ONLY from .env.
// Public proof: out/testnet_zero_price.json. Usage: node --env-file=.env scripts/prove_zero_price_testnet.mjs [--check]
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

const REQUIRE_MESSAGE = "Price must be > 0";
const ZERO_PRICE = 0;
const HONEST_PRICE = 3;
const REWARD = "0.05";
const COMMIT_LEN = 120;
const REVEAL_LEN = 120;
const GAS = teraToGas("50");
const verifierId = `verifier.${root}`;
const zeroId = `worker-1.${root}`;
const honestId = `worker-2.${root}`;
const CHECK = process.argv.includes("--check");
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

const keyFiles = { verifier: join(OUT, "verifier.testnet.key"), zero: join(OUT, "worker-1.testnet.key"), honest: join(OUT, "worker-2.testnet.key") };
for (const f of Object.values(keyFiles)) {
  if (!existsSync(f)) { console.error(`BLOQUEO: ${f} missing; run npm run testnet:market first`); process.exit(2); }
}

// preflight: the live code must be the price>0 build, otherwise the proof would show the OLD behaviour
const wasm = join(HERE, "..", "..", "contract", "target", "near", "contract.wasm");
const localSha = existsSync(wasm) ? createHash("sha256").update(readFileSync(wasm)).digest("hex") : null;
const code = await rpc("query", { request_type: "view_code", finality: "final", account_id: market });
const liveCode = code.result ? Buffer.from(code.result.code_base64, "base64") : null;
const liveSha = liveCode ? createHash("sha256").update(liveCode).digest("hex") : null;
const liveHasGuard = !!liveCode && liveCode.includes(Buffer.from(REQUIRE_MESSAGE));
const libRs = readFileSync(join(HERE, "..", "..", "contract", "src", "lib.rs"), "utf8");
const srcHasGuard = libRs.includes(`require!(price > 0, "${REQUIRE_MESSAGE}")`);
const bal = await rpc("query", { request_type: "view_account", finality: "final", account_id: root });
const rootNear = bal.result ? Number(BigInt(bal.result.amount) / 10n ** 21n) / 1000 : null;
const pre = { live_sha256: liveSha, local_wasm_sha256: localSha, live_is_local: !!liveSha && liveSha === localSha, src_has_guard: srcHasGuard, live_has_guard: liveHasGuard, root_balance_near: rootNear };
console.log(`preflight ${JSON.stringify(pre)}`);
if (CHECK) process.exit(pre.live_is_local && srcHasGuard && liveHasGuard ? 0 : 3);
if (!pre.live_is_local || !srcHasGuard || !liveHasGuard) { console.error("BLOQUEO: price>0 wasm not live yet (redeploy first)"); process.exit(3); }
if (rootNear !== null && rootNear < 0.6) { console.error(`BLOQUEO: root balance ${rootNear} NEAR < 0.6`); process.exit(3); }

const verifier = new Account(verifierId, provider, readFileSync(keyFiles.verifier, "utf8").trim());
const zero = new Account(zeroId, provider, readFileSync(keyFiles.zero, "utf8").trim());
const honest = new Account(honestId, provider, readFileSync(keyFiles.honest, "utf8").trim());

const taskId = `zero-price-proof-${await finalHeight()}-${root}`;
const proof = { network: "testnet", rpc: rpcUrl, market, task_id: taskId, live_sha256: liveSha,
  guard: `require!(price > 0, "${REQUIRE_MESSAGE}")`, zero_bidder: zeroId, honest_bidder: honestId, txs: {} };

for (const w of [zero, honest]) {
  try { await call(w, "register_worker", {}); } catch (e) { if (!String(e.message).includes("already registered")) throw e; }
}
proof.txs.post_task = await call(rootAccount, "post_task", { id: taskId, verifier: verifierId, commit_len: COMMIT_LEN, reveal_len: REVEAL_LEN }, BigInt(nearToYocto(REWARD)));
proof.txs.commit_zero = await call(zero, "commit_bid", { task_id: taskId, commitment: commitmentOf(ZERO_PRICE, 11, zeroId) });
proof.txs.commit_honest = await call(honest, "commit_bid", { task_id: taskId, commitment: commitmentOf(HONEST_PRICE, 13, honestId) });
const open = await viewUntil("get_round", { task_id: taskId }, (x) => x?.state === "Open");
await waitHeight(open.commit_end);

// ATTACK: reveal at price 0 must be rejected by the require (near-api-js throws on a contract panic)
let attackTx = null, failStr = "", rejected = false;
try {
  const r = await zero.callFunctionRaw({ contractId: market, methodName: "reveal_bid", args: { task_id: taskId, price: ZERO_PRICE, salt: 11 }, deposit: 0n, gas: GAS });
  attackTx = r.transaction?.hash ?? null;
  failStr = JSON.stringify(r.status ?? {});
  rejected = failStr.includes(REQUIRE_MESSAGE);
} catch (e) {
  const tr = e?.transactionResult;
  attackTx = tr?.transaction?.hash ?? tr?.transaction_outcome?.id ?? e?.transaction?.hash ?? null;
  failStr = JSON.stringify(tr?.status ?? {}) + " " + String(e?.message ?? e);
  rejected = failStr.includes(REQUIRE_MESSAGE);
}
proof.attack = { price: ZERO_PRICE, tx: attackTx, nearblocks: attackTx ? nearblocks(attackTx) : null, rejected,
  require_message: REQUIRE_MESSAGE, failure_excerpt: failStr.slice(0, 260) };

proof.txs.reveal_honest = await call(honest, "reveal_bid", { task_id: taskId, price: HONEST_PRICE, salt: 13 });
await waitHeight(open.reveal_end);
proof.txs.close_round = await call(rootAccount, "close_round", { task_id: taskId });
const closed = await viewUntil("get_round", { task_id: taskId }, (x) => x?.state === "Closed" || x?.winner);
proof.winner = closed.winner;
const validHash = createHash("sha256").update(`zero-price-proof ${taskId}`).digest("hex");
if (closed.winner === honestId) {
  proof.txs.submit_result = await call(honest, "submit_result", { task_id: taskId, result_hash: validHash });
  proof.txs.attest = await call(verifier, "attest", { task_id: taskId, ok: true });
}
const settled = await viewUntil("get_task", { task_id: taskId }, (t) => t?.state === "Settled" || t?.state === "Refunded");
proof.final_state = settled?.state;
proof.pass = rejected && proof.winner === honestId && proof.final_state === "Settled";
writeFileSync(join(OUT, "testnet_zero_price.json"), JSON.stringify(proof, null, 2) + "\n");
console.log(`zero-price reveal rejected=${rejected} tx=${attackTx}; winner=${proof.winner} final=${proof.final_state}; PASS=${proof.pass} -> out/testnet_zero_price.json`);
if (!proof.pass) process.exit(1);
