// client_testnet.mjs v1.3 - same flow as client_worker.mjs, against NEAR testnet (idempotent).
// Credentials ONLY from .env (NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, NEAR_CONTRACT_ID, NEAR_RPC_URL).
// Usage: node --env-file=.env scripts/client_testnet.mjs [N]   (N = worker index, default 1)
// Result: worker-N.<account> keeps exactly one FunctionCall key for the market methods; the key goes to
// out/worker-N.testnet.key (mode 600, git-ignored) and is never printed. Public report: out/client_worker_testnet.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, nearToYocto } from "near-api-js";

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
const rpc = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
if (!root.endsWith(".testnet")) {
  console.error("BLOQUEO: testnet accounts only");
  process.exit(2);
}

const WORKER_METHODS = ["register_worker", "commit_bid", "reveal_bid", "submit_result"];
const ALLOWANCE = "0.25";
const n = process.argv[2] || "1";
const workerId = `worker-${n}.${root}`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const KEY_FILE = join(OUT, `worker-${n}.testnet.key`);
mkdirSync(OUT, { recursive: true });

const provider = new JsonRpcProvider({ url: rpc });
const exists = async (accountId) => {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
};

const txs = {};
if (!(await exists(workerId))) {
  const rootAccount = new Account(root, provider, rootKey);
  const fullKey = KeyPair.fromRandom("ed25519");
  const created = await rootAccount.createAccount({
    newAccountId: workerId,
    publicKey: fullKey.getPublicKey().toString(),
    nearToTransfer: nearToYocto("1"),
  });
  txs.create_account = created.transaction.hash;
  const worker = new Account(workerId, provider, fullKey.toString());
  const limitedKey = KeyPair.fromRandom("ed25519");
  const added = await worker.addFunctionCallAccessKey({
    publicKey: limitedKey.getPublicKey().toString(),
    contractId: market,
    methodNames: WORKER_METHODS,
    allowance: nearToYocto(ALLOWANCE),
  });
  txs.grant_market_methods = added.transaction.hash;
  const deleted = await worker.deleteKey(fullKey.getPublicKey().toString());
  txs.drop_admin_rights = deleted.transaction.hash;
  writeFileSync(KEY_FILE, limitedKey.toString(), { mode: 0o600 });
} else if (!existsSync(KEY_FILE)) {
  console.error(`FAIL: ${workerId} exists but ${KEY_FILE} is missing; use another index N`);
  process.exit(1);
}

const expectedKey = KeyPair.fromString(readFileSync(KEY_FILE, "utf8").trim()).getPublicKey().toString();
const { keys } = await provider.viewAccessKeyList({ accountId: workerId });
const fc = keys[0]?.access_key?.permission?.FunctionCall;
const ok =
  keys.length === 1 &&
  keys[0].public_key === expectedKey &&
  fc?.receiver_id === market &&
  JSON.stringify(fc?.method_names) === JSON.stringify(WORKER_METHODS) &&
  BigInt(fc?.allowance ?? 0) > 0n &&
  BigInt(fc.allowance) <= BigInt(nearToYocto(ALLOWANCE));

writeFileSync(
  join(OUT, "client_worker_testnet.json"),
  JSON.stringify(
    {
      network: "testnet",
      worker: workerId,
      market,
      limited_public_key: expectedKey,
      methods: WORKER_METHODS,
      allowance_initial: `${ALLOWANCE} NEAR`,
      allowance_remaining_yocto: fc?.allowance ?? null,
      keys_onchain: keys.length,
      txs,
      ok,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  ok
    ? `OK ${workerId}: 1 key on-chain, FunctionCall to ${market} (${WORKER_METHODS.join(",")}), allowance <= ${ALLOWANCE} NEAR`
    : `FAIL ${workerId}: unexpected keys on-chain (${keys.length})`,
);
process.exitCode = ok ? 0 : 1;
