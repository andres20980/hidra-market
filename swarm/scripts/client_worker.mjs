// client_worker.mjs v1.0 - cliente NEAR (near-api-js) probado contra near-sandbox
// Crea subcuenta worker-N, le deja SOLO una function-call key limitada al contrato
// del mercado y a los metodos de la ronda; verifica los permisos via RPC.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, nearToYocto } from "near-api-js";
import { Sandbox } from "near-kit/sandbox";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");
mkdirSync(OUT, { recursive: true });

// Metodos del mercado que puede llamar un trabajador (producto/RULES.md v1.0)
const WORKER_METHODS = ["register_worker", "commit_bid", "reveal_bid", "submit_result"];
const WORKER_FUNDING = "5 NEAR";
const KEY_ALLOWANCE = "0.25 NEAR";

const sandbox = await Sandbox.start();
try {
  const root = sandbox.rootAccount.id;
  const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
  const rootAccount = new Account(root, provider, sandbox.rootAccount.secretKey);
  const market = `market.${root}`;
  const workerId = `worker-1.${root}`;

  // 1. subcuenta worker-N con clave full-access inicial (K1)
  const fullKey = KeyPair.fromRandom("ed25519");
  await rootAccount.createAccount({
    newAccountId: workerId,
    publicKey: fullKey.getPublicKey().toString(),
    nearToTransfer: nearToYocto(WORKER_FUNDING.replace(" NEAR", "")),
  });

  // 2. desde worker-1: anyade K2 limitada a metodos del mercado y borra K1
  const workerAccount = new Account(workerId, provider, fullKey.toString());
  const limitedKey = KeyPair.fromRandom("ed25519");
  await workerAccount.addFunctionCallAccessKey({
    publicKey: limitedKey.getPublicKey().toString(),
    contractId: market,
    methodNames: WORKER_METHODS,
    allowance: nearToYocto(KEY_ALLOWANCE.replace(" NEAR", "")),
  });
  await workerAccount.deleteKey(fullKey.getPublicKey().toString());

  // 3. verificacion on-chain: solo queda la key limitada
  const keys = await provider.viewAccessKeyList({ accountId: workerId });
  const state = await provider.viewAccount({ accountId: workerId });
  const remaining = keys.keys.map((k) => ({
    public_key: k.public_key,
    permission: k.access_key.permission,
  }));
  const ok =
    remaining.length === 1 &&
    remaining[0].public_key === limitedKey.getPublicKey().toString() &&
    typeof remaining[0].permission === "object" &&
    remaining[0].permission.FunctionCall.receiver_id === market &&
    JSON.stringify(remaining[0].permission.FunctionCall.method_names) === JSON.stringify(WORKER_METHODS);

  const report = {
    sandbox_rpc: sandbox.rpcUrl,
    root,
    market,
    worker: workerId,
    worker_balance: String(state.amount),
    limited_key: limitedKey.getPublicKey().toString(),
    allowance: KEY_ALLOWANCE,
    methods: WORKER_METHODS,
    keys_onchain: remaining,
    ok,
  };
  writeFileSync(join(OUT, "client_worker_sandbox.json"), JSON.stringify(report, null, 2));
  console.log(ok ? `OK: ${workerId} solo tiene key FunctionCall a ${market} ${WORKER_METHODS.join(",")}` : "FAIL: permisos inesperados");
  process.exitCode = ok ? 0 : 1;
} finally {
  await sandbox.stop();
}
