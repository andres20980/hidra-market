// sandbox_round.mjs v1.3
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Near, InMemoryKeyStore, generateKey, parseAmount } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM = join(HERE, "..", "..", "contract", "target", "wasm32-unknown-unknown", "release", "contract.wasm");
const OUT = join(HERE, "..", "out", "sandbox_round.json");
const WORKERS = 5;
const COMMIT_LEN = 10;
const REVEAL_LEN = 10;
const REWARD = "1 NEAR";
const CAP_PER_AGENT = "100 NEAR";
const BIDS = [80, 120, 60, 140, 100];
const MARKET_METHODS = ["register_worker", "commit_bid", "reveal_bid", "submit_result"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest();
const commitmentOf = (price, salt, accountId) => {
  const payload = Buffer.alloc(12 + accountId.length);
  payload.writeBigUInt64BE(BigInt(price), 0);
  payload.writeUInt32BE(salt, 8);
  payload.write(accountId, 12, "utf8");
  return new Uint8Array(sha256(payload));
};

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

const sandbox = await Sandbox.start();
const root = sandbox.rootAccount.id;
const keyStore = new InMemoryKeyStore({ [root]: sandbox.rootAccount.secretKey });
const near = new Near({ network: sandbox, keyStore, defaultSignerId: root });

const market = `market.${root}`;
const publisher = `publisher.${root}`;
const verifier = `verifier.${root}`;
const workerIds = Array.from({ length: WORKERS }, (_, i) => `worker-${i}.${root}`);

const call = async (signerId, contractId, methodName, args, attachedDeposit) => {
  return await near.transaction(signerId).functionCall(contractId, methodName, args, {
    gas: "60 Tgas",
    ...(attachedDeposit ? { attachedDeposit } : {}),
  }).send();
};

const view = (contractId, methodName, args) => near.view(contractId, methodName, args);

try {
  const wasm = readFileSync(WASM);
  await near.transaction(root).createAccount(market).transfer(market, "50 NEAR").deployContract(market, wasm).send();
  await call(root, market, "init", { cap_per_agent: "1000000000000000000000000" });

  for (const account of [publisher, verifier]) {
    const key = generateKey();
    await near.transaction(root).createAccount(account).transfer(account, "10 NEAR").addKey(key.publicKey.toString(), { type: "fullAccess" }).send();
    await keyStore.add(account, key);
  }

  const workerKeys = [];
  for (const [index, workerId] of workerIds.entries()) {
    const key = generateKey();
    workerKeys.push(key);
    await near.transaction(root).createAccount(workerId).transfer(workerId, "5 NEAR").addKey(key.publicKey.toString(), {
      type: "functionCall",
      receiverId: market,
      methodNames: MARKET_METHODS,
      allowance: "1 NEAR",
    }).send();
    await keyStore.add(workerId, key);
  }

  for (const workerId of workerIds) {
    await call(workerId, market, "register_worker", {});
  }

  const taskId = `round-${Date.now()}`;
  await call(publisher, market, "post_task", {
    id: taskId,
    verifier,
    commit_len: COMMIT_LEN,
    reveal_len: REVEAL_LEN,
  }, REWARD);

  const salts = [11, 22, 33, 44, 55];
  for (const [index, workerId] of workerIds.entries()) {
    await call(workerId, market, "commit_bid", {
      task_id: taskId,
      commitment: Array.from(commitmentOf(BIDS[index], salts[index], workerId)),
    });
  }

  await sandbox.fastForward(COMMIT_LEN);
  for (const [index, workerId] of workerIds.entries()) {
    await call(workerId, market, "reveal_bid", {
      task_id: taskId,
      price: BIDS[index],
      salt: salts[index],
    });
  }

  await sandbox.fastForward(REVEAL_LEN);
  await call(publisher, market, "close_round", { task_id: taskId });
  
  const closed = await view(market, "get_task", { task_id: taskId });
  if (!closed || closed.state !== "Closed") fail(`close_round left state ${closed && closed.state}`);
  
  await call(workerIds[2], market, "submit_result", {
    task_id: taskId,
    result_hash: sha256(Buffer.from("bundle")).toString("hex"),
  });
  await call(verifier, market, "attest", { task_id: taskId, ok: true });

  const settled = await view(market, "get_task", { task_id: taskId });
  const [alpha, beta, media] = await view(market, "get_reputation", { account: workerIds[2] });
  
  const balances = await near.getBalance(workerIds[2]);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    network: "near-sandbox",
    root, market, task_id: taskId,
    winner: settled.winner,
    state: settled.state,
    reputation_winner: { alpha, beta, media },
    worker_balance_winner: balances,
  }, null, 2), "utf8");

  console.log("Sandbox round completed successfully");
} catch (e) {
  console.error(e);
  process.exit(1);
}
