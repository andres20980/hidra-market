// test/contract_source_pins.test.js v1.0
// Reproducibility lock: the round-spam proof's require message and storage
// reserve must match the FROZEN contract source, not just a copy pasted in the
// JS prover. Reads contract/src/lib.rs and fails if they ever diverge.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REQUIRE_MESSAGE,
  STORAGE_RESERVE_YOCTO,
} from "../scripts/prove_round_spam_testnet.mjs";

const src = readFileSync(
  new URL("../../contract/src/lib.rs", import.meta.url),
  "utf8"
);

describe("round-spam proof is pinned to the frozen contract source", () => {
  it("require message in the JS prover is the exact string in lib.rs", () => {
    // the guard's require!(...) literal must appear verbatim in the contract
    expect(src.includes(`"${REQUIRE_MESSAGE}"`)).toBe(true);
  });

  it("STORAGE_RESERVE_YOCTO matches the const in lib.rs", () => {
    const m = src.match(/const\s+STORAGE_RESERVE:\s*u128\s*=\s*([0-9_]+)\s*;/);
    expect(m).not.toBeNull();
    const fromSource = BigInt(m[1].replace(/_/g, ""));
    expect(fromSource).toBe(STORAGE_RESERVE_YOCTO);
  });

  it("the require message is guarded by STORAGE_RESERVE (same invariant)", () => {
    // the reserve const and the message live in one require! block
    const guard = src.match(
      /require!\(\s*[\s\S]*?STORAGE_RESERVE[\s\S]*?"([^"]+)"\s*\)/
    );
    expect(guard).not.toBeNull();
    expect(guard[1]).toBe(REQUIRE_MESSAGE);
  });
});
