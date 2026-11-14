// reregistration.test.js v1.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRE_MESSAGE, evaluate, multiplier } from "../scripts/prove_reregistration_testnet.mjs";

const proof = JSON.parse(readFileSync(new URL("../out/testnet_reregistration.json", import.meta.url)));

describe("re-registration laundering proof (offline)", () => {
  it("multiplier mirrors (alpha+beta)/alpha", () => {
    expect(multiplier(["1", "3"])).toBe(4);
    expect(multiplier([1, 1])).toBe(2);
  });

  it("evaluate passes only on rejection with the require message and unchanged Beta", () => {
    const ok = evaluate({ before: ["1", "3"], after: ["1", "3"], rejected: true, failure: `panic: ${REQUIRE_MESSAGE}` });
    expect(ok.pass).toBe(true);
    expect(ok.fresh_identity_multiplier).toBe(2);
    expect(evaluate({ before: ["1", "3"], after: ["1", "1"], rejected: true, failure: REQUIRE_MESSAGE }).pass).toBe(false);
    expect(evaluate({ before: ["1", "3"], after: ["1", "3"], rejected: false, failure: "" }).pass).toBe(false);
  });

  it("live testnet proof: re-register rejected, worker-5b keeps Beta(1,3) and pays x4", () => {
    expect(proof.pass).toBe(true);
    expect(proof.rejected && proof.require_message_seen && proof.reputation_unchanged).toBe(true);
    expect(proof.reputation_after.slice(0, 2)).toEqual(["1", "3"]);
    expect(proof.multiplier_after).toBe(4);
    expect(proof.tx).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  });
});
