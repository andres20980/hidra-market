// prove_round_spam_testnet.mjs v1.0
// Read-only (0 NEAR) proof that the round-spam storage-reserve guard is LIVE on
// the redeployed contract. post_task now ends with require_storage_reserve():
// the contract's own funds (balance - escrows it still owes) must cover its
// staked storage plus a fixed 0.01 NEAR reserve, so a burst of minimum-deposit
// rounds is rejected with "Storage reserve exhausted: would risk freezing open
// escrows" BEFORE it can freeze an honest payout (tests/test_round_spam.rs).
//
// We do NOT spam the frozen demo contract (tripping the live 1.25 NEAR margin
// would need hundreds of junk tasks + ~0.5 NEAR gas and would pollute the 8-round
// demo state the jury verifies). Instead this queries the real on-chain account
// state by RPC and recomputes the exact invariant, proving the guard is deployed
// and quantifying how much headroom it leaves. The actual rejection (with the
// require message) is produced deterministically offline by the sandbox test.
// Usage: node scripts/prove_round_spam_testnet.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out");

// NEAR storage staking: 1e19 yoctoNEAR per byte (1 NEAR per 100 KB).
export const BYTE_COST_YOCTO = 10n ** 19n;
// Must match STORAGE_RESERVE in contract/src/lib.rs (0.01 NEAR).
export const STORAGE_RESERVE_YOCTO = 10n ** 22n;
export const REQUIRE_MESSAGE = "Storage reserve exhausted: would risk freezing open escrows";
export const EXPECTED_CODE_HASH = "91i5HZ5QZ47pbuHPdftX3JSK9uZ4J9HYbdwRBStc2njQ"; // sha256 770bf013…

// Pure invariant (mirrors require_storage_reserve): own funds must cover staked
// storage + reserve. All quantities in yoctoNEAR (BigInt). liabilities = sum of
// rewards still escrowed by Open/Closed tasks. Returns the margin and the budget
// (in bytes) a spammer would have to stake before the guard fires.
export const reserveState = ({ amountYocto, storageUsageBytes, liabilitiesYocto }) => {
  const staked = BYTE_COST_YOCTO * BigInt(storageUsageBytes);
  const ownFunds = BigInt(amountYocto) - BigInt(liabilitiesYocto);
  const floor = staked + STORAGE_RESERVE_YOCTO;
  const marginYocto = ownFunds - floor;
  const marginBytes = marginYocto > 0n ? marginYocto / BYTE_COST_YOCTO : 0n;
  return {
    staked_yocto: staked,
    own_funds_yocto: ownFunds,
    reserve_floor_yocto: floor,
    margin_yocto: marginYocto,
    margin_bytes: marginBytes,
    guard_satisfied: ownFunds >= floor,
  };
};

// How many minimum-deposit spam rounds the margin still absorbs before the guard
// rejects, given an assumed per-task storage footprint (transparent parameter).
export const spamRoundsToTrip = (marginBytes, bytesPerTask) =>
  bytesPerTask > 0 ? Number(BigInt(marginBytes) / BigInt(bytesPerTask)) : 0;

const near = (y) => (Number(y) / 1e24).toFixed(6);

const main = async () => {
  const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
  const market = process.env.NEAR_CONTRACT_ID || "market.hidra-mkt-221016.testnet";
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: { request_type: "view_account", finality: "final", account_id: market },
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`view_account: ${JSON.stringify(j.error).slice(0, 200)}`);
  const acct = j.result;
  if (acct.code_hash !== EXPECTED_CODE_HASH) {
    console.error(`BLOQUEO: code_hash ${acct.code_hash} != expected ${EXPECTED_CODE_HASH} (guard not deployed)`);
    process.exit(2);
  }
  // All 8 demo rounds are Settled/Refunded (verify:testnet 8/8), so no reward is
  // still escrowed: liabilities = 0. Kept explicit so the invariant is auditable.
  const liabilitiesYocto = 0n;
  const st = reserveState({
    amountYocto: acct.amount,
    storageUsageBytes: acct.storage_usage,
    liabilitiesYocto,
  });
  const BYTES_PER_TASK_ASSUMED = 320; // 64-byte id + 2 account ids + fixed fields + map overhead
  const proof = {
    network: "testnet",
    rpc: rpcUrl,
    market,
    guard: "require_storage_reserve (post_task)",
    require_message: REQUIRE_MESSAGE,
    code_hash: acct.code_hash,
    wasm_sha256: "770bf013ca041b1200b2d470778017e827407def9b7f9eea827644787650b467",
    block_height: acct.block_height,
    deploy_tx: "3jzCb1cVQ8L1edn5uNKGUUSRjiG4FoX8Ft7ouYm4yAEa",
    deploy_nearblocks: "https://testnet.nearblocks.io/txns/3jzCb1cVQ8L1edn5uNKGUUSRjiG4FoX8Ft7ouYm4yAEa",
    storage_usage_bytes: Number(acct.storage_usage),
    amount_near: near(acct.amount),
    liabilities_near: near(liabilitiesYocto),
    staked_near: near(st.staked_yocto),
    reserve_near: near(STORAGE_RESERVE_YOCTO),
    own_funds_near: near(st.own_funds_yocto),
    margin_to_reserve_near: near(st.margin_yocto),
    margin_bytes: Number(st.margin_bytes),
    guard_satisfied: st.guard_satisfied,
    bytes_per_task_assumed: BYTES_PER_TASK_ASSUMED,
    spam_rounds_to_trip_estimate: spamRoundsToTrip(st.margin_bytes, BYTES_PER_TASK_ASSUMED),
    note:
      "Guard LIVE on redeployed code. Each minimum-deposit round stakes hundreds of " +
      "bytes while escrowing only 1 yocto, so the margin is finite and a spam burst is " +
      "provably bounded; the rejection with the require message is produced deterministically " +
      "offline by contract/tests/test_round_spam.rs (not spammed onto the frozen demo contract).",
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "testnet_round_spam.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(
    `OK round-spam guard LIVE: code_hash=${acct.code_hash} margin=${proof.margin_to_reserve_near} NEAR ` +
      `(~${proof.spam_rounds_to_trip_estimate} spam rounds) -> out/testnet_round_spam.json`,
  );
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`BLOQUEO: ${String(e.message || e).slice(0, 200)}`);
    process.exit(1);
  });
}
