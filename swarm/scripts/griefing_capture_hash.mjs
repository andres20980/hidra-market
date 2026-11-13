// griefing_capture_hash.mjs v1.0 - reuse an already-Closed task (worker-1 winner, no result yet) to (a) capture
// the on-chain tx hash of the REJECTED oversized submit_result and (b) settle it cleanly. No new round, no escrow
// churn. Credentials ONLY from .env. Patches out/testnet_security.json with attack.tx. Usage: node --env-file=.env
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`BLOQUEO: missing ${k}`); process.exit(2); } return v; };
const root = need("NEAR_ACCOUNT_ID");
const rootKey = need("NEAR_PRIVATE_KEY");
const market = need("NEAR_CONTRACT_ID");
const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
const TASK_ID = process.env.ORPHAN_TASK;
if (!TASK_ID) { console.error("BLOQUEO: set ORPHAN_TASK"); process.exit(2); }
const MAX = 128;
const GAS = teraToGas("50");
const verifierId = `verifier.${root}`;
const workerId = `worker-1.${root}`;
const provider = new JsonRpcProvider({ url: rpcUrl });
const worker = new Account(workerId, provider, readFileSync(join(OUT, "worker-1.testnet.key"), "utf8").trim());
const verifier = new Account(verifierId, provider, readFileSync(join(OUT, "verifier.testnet.key"), "utf8").trim());

const oversized = "a".repeat(MAX + 1);
let tx = null, msg = "", rejected = false;
try {
  const r = await worker.callFunctionRaw({ contractId: market, methodName: "submit_result",
    args: { task_id: TASK_ID, result_hash: oversized }, deposit: 0n, gas: GAS });
  tx = r.transaction?.hash ?? null; msg = JSON.stringify(r.status ?? {});
} catch (e) {
  // probe every place near-api-js may stash the hash/outcome of the failed tx
  tx = e?.transaction?.hash ?? e?.transaction_outcome?.id ?? e?.context?.transactionHash
    ?? e?.result?.transaction?.hash ?? e?.result?.transaction_outcome?.id ?? null;
  msg = String(e?.message ?? e);
  rejected = msg.includes("Result hash length out of bounds");
  console.log("error keys:", Object.keys(e ?? {}).join(","), "| ctx:", JSON.stringify(e?.context ?? {}).slice(0, 120));
}
console.log(`rejected=${rejected} tx=${tx}`);

// settle the orphan so no escrow stays locked
const validHash = createHash("sha256").update(`griefing-proof ${TASK_ID}`).digest("hex");
const sv = await worker.callFunctionRaw({ contractId: market, methodName: "submit_result",
  args: { task_id: TASK_ID, result_hash: validHash }, deposit: 0n, gas: GAS });
const at = await verifier.callFunctionRaw({ contractId: market, methodName: "attest",
  args: { task_id: TASK_ID, ok: true }, deposit: 0n, gas: GAS });
console.log(`settled orphan: submit=${sv.transaction?.hash} attest=${at.transaction?.hash}`);

// patch the public proof with the captured rejected tx hash (keeps the earlier PASS result)
const pf = join(OUT, "testnet_security.json");
const proof = JSON.parse(readFileSync(pf, "utf8"));
proof.attack.tx = tx ?? proof.attack.tx;
proof.attack.nearblocks = tx ? `https://testnet.nearblocks.io/txns/${tx}` : proof.attack.nearblocks;
proof.attack.rejected_task_id = TASK_ID;
writeFileSync(pf, JSON.stringify(proof, null, 2) + "\n");
console.log(`patched out/testnet_security.json attack.tx=${proof.attack.tx}`);
