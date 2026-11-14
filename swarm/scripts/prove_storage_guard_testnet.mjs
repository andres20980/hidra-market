// prove_storage_guard_testnet.mjs v1.1
// Read-only (0 NEAR, no keys) proof that the code LIVE on the market account is byte-for-byte the
// LISTO-DEPLOY wasm whose storage-reserve guard now covers post_task, register_worker and commit_bid
// (contract/src/lib.rs; offline rejections in contract/tests/test_registration_spam.rs and test_round_spam.rs).
// It fetches the deployed code with view_code, hashes it, checks the require message is embedded,
// and recomputes the reserve margin from view_account. Output: out/testnet_storage_guard.json.
// Usage: node scripts/prove_storage_guard_testnet.mjs
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRE_MESSAGE, reserveState } from "./prove_round_spam_testnet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");

export const EXPECTED_WASM_SHA256 = "aaa5eb6a72d2d7e81ee3c23e2eebd3b89f31b9de2b7378f849d64036a5176160";
export const EXPECTED_CODE_HASH = "CV93pzSGJS4FZuZb1eMon7qsrn584KWKXtVyeEc49pfR";
export const DEPLOY_TX = "GJoE5zeyJBZBuyVR1QarLZHRciUit2kq5wQ68pffrj8w";
export const GUARDED_METHODS = ["post_task", "register_worker", "commit_bid"];

export const inspectCode = (codeBase64) => {
  const wasm = Buffer.from(codeBase64, "base64");
  return {
    wasm_bytes: wasm.length,
    wasm_sha256: createHash("sha256").update(wasm).digest("hex"),
    require_message_embedded: wasm.includes(Buffer.from(REQUIRE_MESSAGE)),
    methods_exported: GUARDED_METHODS.filter((m) => wasm.includes(Buffer.from(m))),
  };
};

const near = (y) => (Number(y) / 1e24).toFixed(6);

const rpc = async (rpcUrl, params) => {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${params.request_type}: ${JSON.stringify(j.error).slice(0, 200)}`);
  return j.result;
};

const main = async () => {
  const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
  const market = process.env.NEAR_CONTRACT_ID || "market.hidra-mkt-221016.testnet";
  const acct = await rpc(rpcUrl, { request_type: "view_account", finality: "final", account_id: market });
  const code = await rpc(rpcUrl, { request_type: "view_code", finality: "final", account_id: market });
  const insp = inspectCode(code.code_base64);
  const st = reserveState({ amountYocto: acct.amount, storageUsageBytes: acct.storage_usage, liabilitiesYocto: 0n });
  const ok =
    acct.code_hash === EXPECTED_CODE_HASH &&
    insp.wasm_sha256 === EXPECTED_WASM_SHA256 &&
    insp.require_message_embedded &&
    insp.methods_exported.length === GUARDED_METHODS.length;
  const proof = {
    network: "testnet",
    rpc: rpcUrl,
    market,
    guard: "require_storage_reserve (post_task, register_worker, commit_bid)",
    require_message: REQUIRE_MESSAGE,
    code_hash: acct.code_hash,
    block_height: acct.block_height,
    ...insp,
    expected_wasm_sha256: EXPECTED_WASM_SHA256,
    deploy_tx: DEPLOY_TX,
    deploy_nearblocks: `https://testnet.nearblocks.io/txns/${DEPLOY_TX}`,
    storage_usage_bytes: Number(acct.storage_usage),
    amount_near: near(acct.amount),
    margin_to_reserve_near: near(st.margin_yocto),
    margin_bytes: Number(st.margin_bytes),
    guard_satisfied: st.guard_satisfied,
    live_code_matches_listo_deploy: ok,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "testnet_storage_guard.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(
    `${ok ? "OK" : "FAIL"} storage guard LIVE: wasm_sha256=${insp.wasm_sha256.slice(0, 8)}… code_hash=${acct.code_hash} ` +
      `require_message=${insp.require_message_embedded} margin=${proof.margin_to_reserve_near} NEAR -> out/testnet_storage_guard.json`,
  );
  if (!ok) process.exit(1);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`BLOQUEO: ${e.message}`); process.exit(1); });
}
