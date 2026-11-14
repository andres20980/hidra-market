// repricing_trace.test.js v1.0
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { replayTrace } from "../scripts/repricing_trace.mjs";

const proofF = JSON.parse(readFileSync(new URL("../out/testnet_market-f.json", import.meta.url), "utf8"));

describe("repricing trace (offline replay of testnet run f)", () => {
  const t = replayTrace(proofF);
  it("replayed winner and final Beta match the chain in every round", () => {
    expect(t.ok).toBe(true);
    expect(t.rounds).toHaveLength(6);
  });
  it("a failure raises the failing worker's multiplier: worker-5b 3x -> 4x after round 2", () => {
    const tl = t.multiplier_timeline["worker-5b.hidra-mkt-221016.testnet"];
    expect(tl.find((x) => x.round === 2).multiplier).toBe(3);
    expect(tl.find((x) => x.round === 3).multiplier).toBe(4);
  });
  it("a success lowers it again: worker-1 2.0x at round 5 -> 1.9x at round 6", () => {
    const tl = t.multiplier_timeline["worker-1.hidra-mkt-221016.testnet"];
    expect(tl.find((x) => x.round === 5).multiplier).toBe(2);
    expect(tl.find((x) => x.round === 6).multiplier).toBeCloseTo(1.9, 10);
  });
  it("detects a tampered winner and a proof without starting reputations", () => {
    const bad = structuredClone(proofF);
    bad.rounds[5].winner = "worker-3.hidra-mkt-221016.testnet";
    expect(replayTrace(bad).ok).toBe(false);
    expect(() => replayTrace({ ...proofF, initial_reputations: undefined })).toThrow(/initial_reputations/);
  });
});
