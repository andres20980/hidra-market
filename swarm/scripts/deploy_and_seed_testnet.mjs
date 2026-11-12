// deploy_and_seed_testnet.mjs v1.0 - deploy the market to NEAR testnet and run one live round to Settled
// Credentials ONLY from .env (NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, NEAR_CONTRACT_ID, NEAR_RPC_URL). No key is printed.
// Steps (idempotent where the chain allows it):
//   1. market.<account>: create + fund + deploy contract.wasm + init(cap_per_agent) with exact UTF-8 JSON bytes
//   2. verifier.<account>: create (its key goes to out/verifier.testnet.key, mode 600, git-ignored)
//   3. worker-1.<account>: scripts/client_testnet.mjs (one FunctionCall key, 0.25 NEAR allowance)
//   4. one round signed by worker-1's LIMITED key: register_worker -> post_task -> commit_bid -> reveal_bid ->
//      close_round -> submit_result -> attest, until the task is Settled
//   5. public proof (account ids, tx hashes, final state, reputation) -> out/testnet_live_proof.json
// Usage: node --env-file=.env scripts/deploy_and_seed_testnet.mjs
import { spawnSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas } from "near-api-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SWARM = join(HERE, "..");
const OUT = join(SWARM, "out");
mkdirSync(OUT, { recursive: true });

const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`BLOQUEO: missing ${k} in .env (see .env.example)`);
    process.exit(2);
  }
  return v;
};
const root = need("NEAR_ACCOUNT_ID");
const rootKey = need("NEAR_PRIVATE_KEY");
const market = need("NEAR_CONTRACT_ID");
const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
if (!root.endsWith(".testnet") || !market.endsWith(`.${root}`)) {
  console.error("BLOQUEO: testnet only, and NEAR_CONTRACT_ID must be a sub-account of NEAR_ACCOUNT_ID");
  process.exit(2);
}

const MARKET_FUNDING = "3";
const VERIFIER_FUNDING = "0.3";
const CAP_PER_AGENT_YOCTO = 10n * 10n ** 24n; // 10 NEAR, above Number.MAX_SAFE_INTEGER: sent as exact JSON bytes
const REWARD = "0.1";
// testnet produces a block every ~0.6 s and each call waits for finality (~3 s): 120 blocks is about 70 s per window
const COMMIT_LEN = 120;
const REVEAL_LEN = 120;
const GAS = teraToGas("50");
const verifierId = `verifier.${root}`;
const workerId = `worker-1.${root}`;
const nearblocks = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;

const provider = new JsonRpcProvider({ url: rpcUrl });
const rootAccount = new Account(root, provider, rootKey);

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
const view = async (methodName, args) => {
  const r = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: market,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  if (!r.result) throw new Error(`view ${methodName}: ${JSON.stringify(r.error ?? r).slice(0, 300)}`);
  return JSON.parse(Buffer.from(r.result.result).toString("utf8"));
};
// receipts on the market land a block or two after the signer's tx: poll final views until they match
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
  const failure = res.status?.Failure;
  if (failure) throw new Error(`${methodName} failed: ${JSON.stringify(failure).slice(0, 300)}`);
  return res.transaction.hash;
};
const commitmentOf = (price, salt, accountId) => {
  const payload = Buffer.alloc(12 + Buffer.byteLength(accountId));
  payload.writeBigUInt64BE(BigInt(price), 0);
  payload.writeUInt32BE(salt, 8);
  payload.write(accountId, 12, "utf8");
  return Array.from(createHash("sha256").update(payload).digest());
};

const proof = { network: "testnet", rpc: rpcUrl, root, market, verifier: verifierId, worker: workerId, txs: {} };

// 1. market account with the contract
const wasmPath = [
  process.env.CARGO_TARGET_DIR && join(process.env.CARGO_TARGET_DIR, "near", "contract.wasm"),
  join(SWARM, "..", "contract", "target", "near", "contract.wasm"),
  process.env.CARGO_TARGET_DIR && join(process.env.CARGO_TARGET_DIR, "wasm32-unknown-unknown", "release", "contract.wasm"),
  join(SWARM, "..", "contract", "target", "wasm32-unknown-unknown", "release", "contract.wasm"),
].find((p) => p && existsSync(p));
if (!wasmPath) {
  console.error("BLOQUEO: contract.wasm not found; run `make verify` (cargo near build) first");
  process.exit(2);
}
const wasm = readFileSync(wasmPath);
proof.wasm_sha256 = createHash("sha256").update(wasm).digest("hex");
const initArgs = new TextEncoder().encode(`{"cap_per_agent":${CAP_PER_AGENT_YOCTO}}`);
const marketState = await accountState(market);
if (!marketState) {
  const res = await rootAccount.signAndSendTransaction({
    receiverId: market,
    actions: [
      actions.createAccount(),
      actions.transfer(BigInt(nearToYocto(MARKET_FUNDING))),
      actions.addFullAccessKey(KeyPair.fromString(rootKey).getPublicKey()),
      actions.deployContract(wasm),
      actions.functionCall("init", initArgs, GAS, 0n),
    ],
  });
  if (res.status?.Failure) throw new Error(`market deploy failed: ${JSON.stringify(res.status.Failure).slice(0, 300)}`);
  proof.txs.market_create_deploy_init = res.transaction.hash;
  console.log(`market ${market}: created, funded ${MARKET_FUNDING} NEAR, deployed, init(cap_per_agent=${CAP_PER_AGENT_YOCTO})`);
} else {
  console.log(`market ${market}: already exists (code_hash ${marketState.code_hash})`);
}
const [cap] = await view("get_config", {});
if (BigInt(cap) !== CAP_PER_AGENT_YOCTO) throw new Error(`cap_per_agent on-chain ${cap} != ${CAP_PER_AGENT_YOCTO}`);
proof.cap_per_agent_yocto = cap;

// 2. verifier account
const verifierKeyFile = join(OUT, "verifier.testnet.key");
if (!(await accountState(verifierId))) {
  const key = KeyPair.fromRandom("ed25519");
  const res = await rootAccount.createAccount({
    newAccountId: verifierId,
    publicKey: key.getPublicKey().toString(),
    nearToTransfer: nearToYocto(VERIFIER_FUNDING),
  });
  writeFileSync(verifierKeyFile, key.toString(), { mode: 0o600 });
  proof.txs.verifier_create = res.transaction.hash;
} else if (!existsSync(verifierKeyFile)) {
  throw new Error(`${verifierId} exists but ${verifierKeyFile} is missing`);
}
const verifier = new Account(verifierId, provider, readFileSync(verifierKeyFile, "utf8").trim());

// 3. worker-1 with a limited FunctionCall key (same script as `make testnet`)
const client = spawnSync(process.execPath, [join(HERE, "client_testnet.mjs"), "1"], { env: process.env, encoding: "utf8" });
process.stdout.write(client.stdout);
process.stderr.write(client.stderr);
if (client.status !== 0) process.exit(client.status ?? 1);
const workerReport = JSON.parse(readFileSync(join(OUT, "client_worker_testnet.json"), "utf8"));
proof.worker_key = {
  limited_public_key: workerReport.limited_public_key,
  methods: workerReport.methods,
  allowance_initial: workerReport.allowance_initial,
  keys_onchain: workerReport.keys_onchain,
  ok: workerReport.ok,
};
Object.assign(proof.txs, Object.fromEntries(Object.entries(workerReport.txs).map(([k, v]) => [`worker_${k}`, v])));
const worker = new Account(workerId, provider, readFileSync(join(OUT, "worker-1.testnet.key"), "utf8").trim());

// 4. one live round, worker calls signed with the limited key
const taskId = `round-${Date.now()}`;
const price = 80;
const salt = randomInt(1, 2 ** 31);
proof.task_id = taskId;
const reputationBefore = await view("get_reputation", { account: workerId });
try {
  proof.txs.register_worker = await call(worker, "register_worker", {});
} catch (e) {
  if (!String(e.message).includes("already registered")) throw e;
}
proof.reputation_before = { alpha: reputationBefore[0], beta: reputationBefore[1] };
proof.txs.post_task = await call(rootAccount, "post_task", { id: taskId, verifier: verifierId, commit_len: COMMIT_LEN, reveal_len: REVEAL_LEN }, BigInt(nearToYocto(REWARD)));
console.log(`post_task ${taskId} (reward ${REWARD} NEAR in escrow)`);
proof.txs.commit_bid = await call(worker, "commit_bid", { task_id: taskId, commitment: commitmentOf(price, salt, workerId) });
const round = await viewUntil("get_round", { task_id: taskId }, (r) => r?.state === "Open");
console.log(`commit_bid ok; waiting for block ${round.commit_end} to reveal`);
await waitHeight(round.commit_end);
proof.txs.reveal_bid = await call(worker, "reveal_bid", { task_id: taskId, price, salt });
console.log(`reveal_bid ok; waiting for block ${round.reveal_end} to close`);
await waitHeight(round.reveal_end);
proof.txs.close_round = await call(rootAccount, "close_round", { task_id: taskId });
proof.txs.submit_result = await call(worker, "submit_result", {
  task_id: taskId,
  result_hash: createHash("sha256").update(`hidra-market testnet ${taskId}`).digest("hex"),
});
proof.txs.attest = await call(verifier, "attest", { task_id: taskId, ok: true });

// 5. read back the public state
const task = await viewUntil("get_task", { task_id: taskId }, (t) => t?.state === "Settled" || t?.state === "Refunded");
const [alpha, beta, mean] = await view("get_reputation", { account: workerId });
proof.final = { state: task.state, winner: task.winner, reward_yocto: task.reward, bids: task.bids, result_hash: task.result_hash };
proof.reputation_after = { alpha, beta, mean };
proof.nearblocks = Object.fromEntries(Object.entries(proof.txs).map(([k, v]) => [k, nearblocks(v)]));
proof.nearblocks.market_account = `https://testnet.nearblocks.io/address/${market}`;
proof.web = `?contract=${market}`;
proof.generated_at = new Date().toISOString();
writeFileSync(join(OUT, "testnet_live_proof.json"), JSON.stringify(proof, null, 2) + "\n");
const ok = task.state === "Settled" && task.winner === workerId;
console.log(`${ok ? "OK" : "FAIL"}: ${taskId} ${task.state}, winner ${task.winner}, reputation Beta(${alpha},${beta}); proof in out/testnet_live_proof.json`);
process.exitCode = ok ? 0 : 1;
