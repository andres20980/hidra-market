// testnet_market_rounds.mjs v1.2 - LIVE replay of the real Hidra ledger on NEAR testnet.
// Runs the deterministic plan from market_plan.mjs on market.<root>: 5 worker sub-accounts (each a real
// brain), each with ONE limited FunctionCall key, bidding sealed in >=6 rounds. Winners whose real
// LOCKED draw succeeds settle; the rest refund via attest(ok=false), so Beta reputations diverge and
// the unreliable brains become expensive. Idempotent. Credentials ONLY from .env (node --env-file).
// Budget-bounded: workers funded WORKER_FUNDING each, rewards REWARD each. Keys never printed/written
// to the public proof. Public proof: out/testnet_market.json. Usage: npm run testnet:market
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas } from "near-api-js";
import { loadWorkers, planRounds, proofFileName } from "./market_plan.mjs";

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
const workerOffset = Number(process.env.WORKER_OFFSET ?? 0);
const marketRun = process.env.MARKET_RUN ?? "c";
if (!Number.isInteger(workerOffset) || workerOffset < 0) throw new Error("WORKER_OFFSET must be a non-negative integer");
if (!/^[a-zA-Z0-9_-]+$/.test(marketRun)) throw new Error("MARKET_RUN must contain only letters, numbers, underscores, or hyphens");
if (workerOffset > 0 && marketRun === "c") throw new Error("WORKER_OFFSET requires a unique MARKET_RUN suffix");
if (!root.endsWith(".testnet")) {
  console.error("BLOQUEO: testnet accounts only");
  process.exit(2);
}

const WORKER_METHODS = ["register_worker", "commit_bid", "reveal_bid", "submit_result"];
const WORKER_FUNDING = "0.35"; // per worker, <= 0.4 NEAR as budgeted
const ALLOWANCE = "0.25"; // gas allowance on each limited key
const REWARD = "0.05"; // escrowed per round, refunded to publisher when Refunded
const COMMIT_LEN = 120; // ~70 s window
const REVEAL_LEN = 120;
const GAS = teraToGas("50");
const verifierId = `verifier.${root}`;

const provider = new JsonRpcProvider({ url: rpcUrl });
const rootAccount = new Account(root, provider, rootKey);

const rpc = async (method, params) => {
  for (let attempt = 0; ; attempt++) {
    // read-only RPC: retrying transient network errors is safe (never used for signed txs)
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).catch((e) => {
      if (attempt >= 5) throw e;
      return null;
    });
    if (!res) {
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
      continue;
    }
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
// commitment = sha256(price:u64 BE || salt:u32 BE || accountId) — must match the contract.
const commitmentOf = (price, salt, accountId) => {
  const payload = Buffer.alloc(12 + Buffer.byteLength(accountId));
  payload.writeBigUInt64BE(BigInt(price), 0);
  payload.writeUInt32BE(salt >>> 0, 8);
  payload.write(accountId, 12, "utf8");
  return Array.from(createHash("sha256").update(payload).digest());
};

// --- ensure the verifier exists (normally created by `npm run testnet:deploy`) ---
const verifierKeyFile = join(OUT, "verifier.testnet.key");
if (!(await accountState(verifierId)) || !existsSync(verifierKeyFile)) {
  console.error(`BLOQUEO: ${verifierId} / ${verifierKeyFile} missing; run \`npm run testnet:deploy\` first`);
  process.exit(2);
}
const verifier = new Account(verifierId, provider, readFileSync(verifierKeyFile, "utf8").trim());

// --- ensure 5 worker sub-accounts, each with exactly one limited FunctionCall key ---
const selectedWorkers = loadWorkers(SWARM, { offset: workerOffset });
// cap-safe second tranche: reuse the already-funded workers (offset 0) and run extra rounds under a
// unique MARKET_RUN; continue reputations from the frozen first tranche so predictions stay faithful.
const extraRounds = Number(process.env.MARKET_ROUNDS ?? 8);
if (!Number.isInteger(extraRounds) || extraRounds < 1) throw new Error("MARKET_ROUNDS must be a positive integer");

const workers = {};
for (const w of selectedWorkers) {
  let tag = `worker-${w.index}`;
  // an account whose key was lost (crash between create and key write) is unrecoverable: use a fresh suffixed id
  if ((await accountState(`${tag}.${root}`)) && !existsSync(join(OUT, `${tag}.testnet.key`))) tag += "b";
  const workerId = `${tag}.${root}`;
  const keyFile = join(OUT, `${tag}.testnet.key`);
  if (!(await accountState(workerId))) {
    const fullKey = KeyPair.fromRandom("ed25519");
    await rootAccount.createAccount({
      newAccountId: workerId,
      publicKey: fullKey.getPublicKey().toString(),
      nearToTransfer: nearToYocto(WORKER_FUNDING),
    });
    const wa = new Account(workerId, provider, fullKey.toString());
    const limited = KeyPair.fromRandom("ed25519");
    await wa.addFunctionCallAccessKey({
      publicKey: limited.getPublicKey().toString(),
      contractId: market,
      methodNames: WORKER_METHODS,
      allowance: nearToYocto(ALLOWANCE),
    });
    await wa.deleteKey(fullKey.getPublicKey().toString());
    writeFileSync(keyFile, limited.toString(), { mode: 0o600 });
  } else if (!existsSync(keyFile)) {
    console.error(`BLOQUEO: ${workerId} exists but ${keyFile} missing`);
    process.exit(1);
  }
  const account = new Account(workerId, provider, readFileSync(keyFile, "utf8").trim());
  const { keys } = await provider.viewAccessKeyList({ accountId: workerId });
  const fc = keys[0]?.access_key?.permission?.FunctionCall;
  workers[w.index] = {
    index: w.index,
    alias: w.alias,
    account_id: workerId,
    account,
    locked_rate: w.locked_rate,
    limited_public_key: keys[0]?.public_key ?? null,
    key_ok: keys.length === 1 && fc?.receiver_id === market && JSON.stringify(fc?.method_names) === JSON.stringify(WORKER_METHODS),
  };
  try {
    await call(account, "register_worker", {});
  } catch (e) {
    if (!String(e.message).includes("already registered")) throw e;
  }
}

// Beta reputation on-chain is append-only, so a later tranche must start from the CURRENT chain
// state (not a frozen file) to keep expected_winner == on-chain winner. Tuple [alpha,beta,mean] or object.
let initialRep = null;
if (marketRun !== "c") {
  initialRep = {};
  for (const w of Object.values(workers)) {
    const rep = await view("get_reputation", { account: w.account_id });
    const [alpha, beta] = Array.isArray(rep) ? rep : [rep.alpha, rep.beta];
    initialRep[w.index] = { alpha: Number(alpha), beta: Number(beta) };
  }
}
const plan = planRounds(selectedWorkers, { rounds: extraRounds, initialRep });

// --- run the deterministic rounds ---
const proof = {
  network: "testnet",
  rpc: rpcUrl,
  root,
  market,
  verifier: verifierId,
  seed: 479,
  reward_per_round: `${REWARD} NEAR`,
  workers: Object.values(workers).map(({ account, ...rest }) => rest),
  initial_reputations: initialRep,
  rounds: [],
};
for (const r of plan.rounds) {
  const taskId = `${r.task_id}-${marketRun}-${root}`;
  const txs = {};
  txs.post_task = await call(rootAccount, "post_task", { id: taskId, verifier: verifierId, commit_len: COMMIT_LEN, reveal_len: REVEAL_LEN }, BigInt(nearToYocto(REWARD)));
  const salts = {};
  txs.commit_bid = {};
  for (const b of r.bidders) {
    const w = workers[b.index];
    const salt = (r.round * 1000 + b.index * 7 + 1) >>> 0;
    salts[b.index] = salt;
    txs.commit_bid[w.account_id] = await call(w.account, "commit_bid", { task_id: taskId, commitment: commitmentOf(b.price, salt, w.account_id) });
  }
  const open = await viewUntil("get_round", { task_id: taskId }, (x) => x?.state === "Open");
  await waitHeight(open.commit_end);
  txs.reveal_bid = {};
  for (const b of r.bidders) {
    const w = workers[b.index];
    txs.reveal_bid[w.account_id] = await call(w.account, "reveal_bid", { task_id: taskId, price: b.price, salt: salts[b.index] });
  }
  await waitHeight(open.reveal_end);
  txs.close_round = await call(rootAccount, "close_round", { task_id: taskId });
  const closed = await viewUntil("get_round", { task_id: taskId }, (x) => x?.state === "Closed" || x?.winner);
  const winnerId = closed.winner ?? workers[r.winner].account_id;
  const winnerW = Object.values(workers).find((x) => x.account_id === winnerId) ?? workers[r.winner];
  txs.submit_result = await call(winnerW.account, "submit_result", {
    task_id: taskId,
    result_hash: createHash("sha256").update(`hidra-market ${taskId}`).digest("hex"),
  });
  txs.attest = await call(verifier, "attest", { task_id: taskId, ok: r.attest_ok });
  const settled = await viewUntil("get_task", { task_id: taskId }, (t) => t?.state === "Settled" || t?.state === "Refunded");
  proof.rounds.push({
    round: r.round,
    task_id: taskId,
    bidders: r.bidders.map((b) => ({ account_id: workers[b.index].account_id, price: b.price })),
    winner: winnerId,
    expected_winner: workers[r.winner].account_id,
    attest_ok: r.attest_ok,
    expected_state: r.state,
    state: settled?.state ?? null,
    reward_yocto: settled?.reward ?? null,
    txs,
  });
  writeFileSync(join(OUT, proofFileName(marketRun)), JSON.stringify({ ...proof, partial: true }, null, 2) + "\n");
  console.log(`round ${r.round}: ${settled?.state} winner=${winnerId} (ok=${r.attest_ok})`);
}

// --- read back final on-chain Beta reputations ---
proof.reputations = [];
for (const w of Object.values(workers)) {
  const [alpha, beta, mean] = await view("get_reputation", { account: w.account_id });
  proof.reputations.push({ index: w.index, alias: w.alias, account_id: w.account_id, locked_rate: w.locked_rate, alpha, beta, mean });
}
proof.settled_count = proof.rounds.filter((r) => r.state === "Settled").length;
proof.refunded_count = proof.rounds.filter((r) => r.state === "Refunded").length;
proof.market_explorer = `https://testnet.nearblocks.io/address/${market}`;
proof.generated_at = new Date().toISOString();
const proofName = proofFileName(marketRun);
writeFileSync(join(OUT, proofName), JSON.stringify(proof, null, 2) + "\n");

const ok =
  proof.rounds.length >= 6 &&
  proof.rounds.every((r) => r.state === r.expected_state && r.winner === r.expected_winner) &&
  proof.settled_count >= 1 &&
  proof.refunded_count >= 1;
console.log(
  `${ok ? "OK" : "FAIL"}: ${proof.rounds.length} rounds, ${proof.settled_count} Settled / ${proof.refunded_count} Refunded; proof in out/${proofName}`,
);
process.exitCode = ok ? 0 : 1;
