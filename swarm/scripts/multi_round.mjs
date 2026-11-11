// multi_round.mjs v2.1 - 5 rondas en near-sandbox, valores u128 como números JS
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Near, InMemoryKeyStore, generateKey } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM = join(HERE, "..", "..", "contract", "target", "wasm32-unknown-unknown", "release", "contract.wasm");
const OUT = join(HERE, "..", "out", "multi_round.json");
const WORKERS = 20;
const PUBLISHERS = 5;
const COMMIT_LEN = 20;
const REVEAL_LEN = 20;
const REWARD_YOCTO = "1 yocto"; // 1 yoctoNEAR, dentro del rango de número JS
const CAP_PER_AGENT = 1000000000000; // 1e12 yoctoNEAR, número JS seguro
const BIDS = Array.from({ length: 20 }, (_, i) => 50 + ((i * 37) % 50));
const MARKET_METHODS = ["register_worker", "commit_bid", "reveal_bid", "submit_result"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest();
const commitmentOf = (price, salt, accountId) => {
  const payload = Buffer.alloc(12 + accountId.length);
  payload.writeBigUInt64BE(BigInt(price), 0);
  payload.writeUInt32BE(salt, 8);
  payload.write(accountId, 12, "utf8");
  return new Uint8Array(sha256(payload));
};

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const sandbox = await Sandbox.start();
const syncFinal = async (ms = 15000) => {
  const t0 = Date.now();
  const rpc = async (finality) => (await (await fetch(sandbox.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality } }) })).json()).result.header.height;
  while (Date.now() - t0 < ms) {
    if ((await rpc("optimistic")) - (await rpc("final")) <= 3) return;
    await new Promise((r) => setTimeout(r, 300));
  }
};

const root = sandbox.rootAccount.id;
const keyStore = new InMemoryKeyStore({ [root]: sandbox.rootAccount.secretKey });
const near = new Near({ network: sandbox, keyStore, defaultSignerId: root });

const market = `market.${root}`;
const publishers = Array.from({ length: PUBLISHERS }, (_, i) => `pub-${i}.${root}`);
const verifier = `verifier.${root}`;
const workerIds = Array.from({ length: WORKERS }, (_, i) => `worker-${i}.${root}`);

const call = async (signerId, contractId, methodName, args, attachedDeposit) => {
  return await near.transaction(signerId).functionCall(contractId, methodName, args, {
    gas: "60 Tgas",
    ...(attachedDeposit ? { attachedDeposit } : {}),
  }).send();
};

const view = (contractId, methodName, args) => near.view(contractId, methodName, args);
const waitState = async (state, ms = 20000, taskId = globalThis.__taskId) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await view(market, "get_round", { task_id: taskId });
    if (t && t.state === state) return t;
    await new Promise((r) => setTimeout(r, 300));
  }
};

try {
  const wasm = readFileSync(WASM);
  await near.transaction(root).createAccount(market).transfer(market, "50 NEAR").deployContract(market, wasm).send();
  await call(root, market, "init", { cap_per_agent: CAP_PER_AGENT });
  for (const account of [...publishers, verifier]) {
    const key = generateKey();
    await near.transaction(root).createAccount(account).transfer(account, "10 NEAR").addKey(key.publicKey.toString(), { type: "fullAccess" }).send();
    await keyStore.add(account, key);
  }
  for (const workerId of workerIds) {
    const key = generateKey();
    await near.transaction(root).createAccount(workerId).transfer(workerId, "5 NEAR").addKey(key.publicKey.toString(), { type: "functionCall", receiverId: market, methodNames: MARKET_METHODS, allowance: "10 NEAR" }).send();
    await keyStore.add(workerId, key);
    await call(workerId, market, "register_worker", {});
  }
  const rounds = [];
  for (const [p, publisher] of publishers.entries()) {
    const taskId = `r${p}-${Date.now()}`;
    await call(publisher, market, "post_task", { id: taskId, verifier, commit_len: COMMIT_LEN, reveal_len: REVEAL_LEN }, REWARD_YOCTO);
    const bids = workerIds.map((w, i) => ({ w, price: BIDS[(i + p) % WORKERS], salt: 100 + i + p * 1000 }));

    await Promise.all(bids.map(b => call(b.w, market, "commit_bid", { task_id: taskId, commitment: Array.from(commitmentOf(b.price, b.salt, b.w)) })));

    await sandbox.fastForward(COMMIT_LEN); await syncFinal();

    await Promise.all(bids.map(b => call(b.w, market, "reveal_bid", { task_id: taskId, price: b.price, salt: b.salt })));

    await sandbox.fastForward(REVEAL_LEN + 1); await syncFinal();
    await call(publisher, market, "close_round", { task_id: taskId });
    const closed = await waitState("Closed", 20000, taskId);
    if (!closed) fail(`round ${p} not Closed`);
    const roundInfo = await view(market, "get_round", { task_id: taskId }); const winnerId = roundInfo.winner; const cheapest = bids.find(b => b.w === winnerId);
    await call(cheapest.w, market, "submit_result", { task_id: taskId, result_hash: sha256(Buffer.from(`bundle-${p}`)).toString("hex") });
    await call(verifier, market, "attest", { task_id: taskId, ok: true });
    const settled = (await waitState("Settled", 20000, taskId)) || (await view(market, "get_round", { task_id: taskId }));
    console.log(`round ${p}: winner=${cheapest.w} state=${settled.state} min_price=${cheapest.price}`);
    rounds.push({ task_id: taskId, publisher, winner: cheapest.w, state: settled.state, min_price: cheapest.price, min_bidder: cheapest.w });
  }
  const settledCount = rounds.filter((r) => r.state === "Settled").length;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ network: "near-sandbox", workers: WORKERS, publishers: PUBLISHERS, rounds, settled_count: settledCount }, null, 2), "utf8");
  console.log(`Multi round completed: ${rounds.length} rounds, settled=${settledCount}`);
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await sandbox.stop?.();
}
