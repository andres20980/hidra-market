// client_testnet.mjs v1.1 - mismo flujo que client_worker.mjs contra testnet.
// Credenciales SOLO por .env (NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, NEAR_CONTRACT_ID, NEAR_RPC_URL).
// Uso: node --env-file=.env scripts/client_testnet.mjs [N]   (N = indice del worker, defecto 1)
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, nearToYocto } from "near-api-js";

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`BLOQUEO: falta ${k} en .env (ver .env.example)`); process.exit(2); }
  return v;
};
const root = need("NEAR_ACCOUNT_ID");
const rootKey = need("NEAR_PRIVATE_KEY");
const market = need("NEAR_CONTRACT_ID");
const rpc = process.env.NEAR_RPC_URL || "https://rpc.testnet.near.org";
if (!root.endsWith("testnet")) { console.error("BLOQUEO: solo testnet"); process.exit(2); }

const WORKER_METHODS = ["register_worker", "commit_bid", "reveal_bid", "submit_result"];
const n = process.argv[2] || "1";
const workerId = `worker-${n}.${root}`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
mkdirSync(OUT, { recursive: true });

const provider = new JsonRpcProvider({ url: rpc });
const rootAccount = new Account(root, provider, rootKey);
const fullKey = KeyPair.fromRandom("ed25519");
await rootAccount.createAccount({
  newAccountId: workerId,
  publicKey: fullKey.getPublicKey().toString(),
  nearToTransfer: nearToYocto("1"),
});
const worker = new Account(workerId, provider, fullKey.toString());
const limitedKey = KeyPair.fromRandom("ed25519");
await worker.addFunctionCallAccessKey({
  publicKey: limitedKey.getPublicKey().toString(),
  contractId: market,
  methodNames: WORKER_METHODS,
  allowance: nearToYocto("0.25"),
});
await worker.deleteKey(fullKey.getPublicKey().toString());
// La clave limitada se guarda en out/ (ignorado por git si .gitignore cubre *.key); nunca se imprime.
writeFileSync(join(OUT, `worker-${n}.testnet.key`), limitedKey.toString(), { mode: 0o600 });
const keys = await provider.viewAccessKeyList({ accountId: workerId });
console.log(`OK ${workerId}: ${keys.keys.length} key(s) on-chain`);
