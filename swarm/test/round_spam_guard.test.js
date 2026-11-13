// test/round_spam_guard.test.js v1.0
// Offline unit test of the round-spam storage-reserve invariant (no network).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  reserveState,
  spamRoundsToTrip,
  BYTE_COST_YOCTO,
  STORAGE_RESERVE_YOCTO,
  REQUIRE_MESSAGE,
  EXPECTED_CODE_HASH,
} from "../scripts/prove_round_spam_testnet.mjs";

const proof = JSON.parse(readFileSync(new URL("../out/testnet_round_spam.json", import.meta.url), "utf8"));

describe("round-spam storage-reserve guard", () => {
  it("satisfies the invariant when own funds cover staked storage + reserve", () => {
    const st = reserveState({
      amountYocto: 3n * 10n ** 24n, // 3 NEAR
      storageUsageBytes: 100_000, // 1 NEAR staked
      liabilitiesYocto: 0n,
    });
    expect(st.guard_satisfied).toBe(true);
    expect(st.staked_yocto).toBe(BYTE_COST_YOCTO * 100_000n);
    // margin = 3 - 1 - 0.01 = 1.99 NEAR
    expect(st.margin_yocto).toBe(199n * 10n ** 22n);
  });

  it("rejects (guard not satisfied) once staked storage + reserve exceed own funds", () => {
    const st = reserveState({
      amountYocto: 101n * 10n ** 22n, // 1.01 NEAR
      storageUsageBytes: 100_000, // exactly 1 NEAR staked, leaves 0.01 = reserve
      liabilitiesYocto: 0n,
    });
    // own funds == staked + reserve exactly -> still satisfied (>=)
    expect(st.guard_satisfied).toBe(true);
    const tighter = reserveState({
      amountYocto: 101n * 10n ** 22n - 1n,
      storageUsageBytes: 100_000,
      liabilitiesYocto: 0n,
    });
    expect(tighter.guard_satisfied).toBe(false);
    expect(tighter.margin_yocto < 0n).toBe(true);
  });

  it("counts open escrows as liabilities that shrink own funds", () => {
    const base = { amountYocto: 3n * 10n ** 24n, storageUsageBytes: 100_000 };
    const noDebt = reserveState({ ...base, liabilitiesYocto: 0n });
    const withDebt = reserveState({ ...base, liabilitiesYocto: 5n * 10n ** 23n }); // 0.5 NEAR owed
    expect(withDebt.margin_yocto).toBe(noDebt.margin_yocto - 5n * 10n ** 23n);
  });

  it("bounds a minimum-deposit spam burst to a finite number of rounds", () => {
    expect(spamRoundsToTrip(125_473n, 320)).toBe(392);
    expect(spamRoundsToTrip(0n, 320)).toBe(0);
    expect(spamRoundsToTrip(125_473n, 0)).toBe(0);
  });

  it("pins the reserve constant and require message to the contract", () => {
    expect(STORAGE_RESERVE_YOCTO).toBe(10n ** 22n); // 0.01 NEAR
    expect(REQUIRE_MESSAGE).toBe("Storage reserve exhausted: would risk freezing open escrows");
  });

  it("matches the live on-chain proof (code redeployed, guard live)", () => {
    expect(proof.code_hash).toBe(EXPECTED_CODE_HASH);
    expect(proof.wasm_sha256).toBe("770bf013ca041b1200b2d470778017e827407def9b7f9eea827644787650b467");
    expect(proof.guard_satisfied).toBe(true);
    expect(proof.require_message).toBe(REQUIRE_MESSAGE);
    // recompute the margin from the published raw fields -> must equal the stored figure
    const st = reserveState({
      amountYocto: BigInt(Math.round(Number(proof.amount_near) * 1e24)),
      storageUsageBytes: proof.storage_usage_bytes,
      liabilitiesYocto: 0n,
    });
    expect(Number(st.margin_bytes)).toBe(proof.margin_bytes);
  });
});
