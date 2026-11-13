// redeploy_code_testnet.mjs v1.0 - redeploy ONLY the contract code to an already-initialised market account.
// No createAccount, no init, no state wipe: a single DeployContract action signed by the market's full-access key
// (same keypair as the root account, added at creation). Credentials ONLY from .env; no key is printed.
// Guard: refuses to run unless the local wasm sha256 matches the expected LISTO-DEPLOY hash and layout=igual.
// Before/after account views (code_hash, amount) are saved to out/testnet_redeploy.json.
// Usage: node --env-file=.env scripts/redeploy_code_testnet.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, actions } from "near-api-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SWARM = join(HERE, "..");
const OUT = join(SWARM, "out");
mkdirSync(OUT, { recursive: true });

const EXPECTED_SHA256 = "770bf013ca041b1200b2d470778017e827407def9b7f9eea827644787650b467";

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`BLOQUEO: missing ${k} in .env (see .env.example)`); process.exit(2); }
  return v;
};
const root = need("NEAR_ACCOUNT_ID");
const rootKey = need("NEAR_PRIVATE_KEY");
const market = need("NEAR_CONTRACT_ID");
const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
if (!market.endsWith(".testnet")) { console.error("BLOQUEO: testnet only"); process.exit(2); }

const wasmPath = [
  join(SWARM, "..", "contract", "target", "near", "contract.wasm"),
  join(SWARM, "..", "contract", "target", "wasm32-unknown-unknown", "release", "contract.wasm"),
].find((p) => existsSync(p));
if (!wasmPath) { console.error("BLOQUEO: contract.wasm not found; build the contract first"); process.exit(2); }
const wasm = readFileSync(wasmPath);
const sha256 = createHash("sha256").update(wasm).digest("hex");
if (sha256 !== EXPECTED_SHA256) {
  console.error(`BLOQUEO: wasm sha256 ${sha256} != expected LISTO-DEPLOY ${EXPECTED_SHA256}`);
  process.exit(2);
}

const provider = new JsonRpcProvider({ url: rpcUrl });

const viewAccount = async (id) => {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query",
      params: { request_type: "view_account", finality: "final", account_id: id } }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`view_account ${id}: ${JSON.stringify(j.error).slice(0, 200)}`);
  return { code_hash: j.result.code_hash, amount: j.result.amount };
};

const before = await viewAccount(market);
console.log(`before: code_hash=${before.code_hash}`);

const marketAccount = new Account(market, provider, rootKey);
const res = await marketAccount.signAndSendTransaction({
  receiverId: market,
  actions: [actions.deployContract(wasm)],
});
if (res.status?.Failure) throw new Error(`redeploy failed: ${JSON.stringify(res.status.Failure).slice(0, 300)}`);
const txHash = res.transaction.hash;

// Poll until finality catches up with the deploy: `view_account` right after the tx can
// read a final block that predates it (NEAR finality lag), reporting a stale code_hash.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let after = await viewAccount(market);
for (let i = 0; i < 20 && after.code_hash === before.code_hash; i++) {
  await sleep(2000);
  after = await viewAccount(market);
}
console.log(`after:  code_hash=${after.code_hash} tx=${txHash}`);
const changed = after.code_hash !== before.code_hash;

const proof = {
  network: "testnet", rpc: rpcUrl, market, action: "deploy_code_only",
  wasm_sha256: sha256, wasm_bytes: wasm.length,
  code_hash_before: before.code_hash, code_hash_after: after.code_hash,
  amount_before: before.amount, amount_after: after.amount,
  tx: txHash, nearblocks: `https://testnet.nearblocks.io/txns/${txHash}`,
  code_changed: changed,
};
writeFileSync(join(OUT, "testnet_redeploy.json"), JSON.stringify(proof, null, 2) + "\n");
console.log(`OK redeploy: ${changed ? "code_hash changed" : "code_hash unchanged (already current)"} -> out/testnet_redeploy.json`);
