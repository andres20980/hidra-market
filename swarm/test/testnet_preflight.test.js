// testnet_preflight.test.js v1.0 - offline unit tests for the pure readiness evaluator (no network).
import { describe, it, expect } from "vitest";
import { evaluateWorker } from "../scripts/preflight_testnet_tranche.mjs";

const MARKET = "market.hidra-mkt-221016.testnet";
const METHODS = ["register_worker", "commit_bid", "reveal_bid", "submit_result"];
const NEAR = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const goodKey = (allowanceNear = 0.25) => [
  { access_key: { permission: { FunctionCall: { receiver_id: MARKET, method_names: METHODS, allowance: NEAR(allowanceNear) } } } },
];

describe("evaluateWorker", () => {
  const base = { account_id: "worker-1.hidra-mkt-221016.testnet", balanceYocto: NEAR(0.3), keys: goodKey(), reputation: { alpha: "9", beta: "5" } };

  it("marks a fully provisioned worker ready", () => {
    const r = evaluateWorker(base, { market: MARKET });
    expect(r.ready).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.balance_near).toBe(0.3);
    expect(r.allowance_near).toBe(0.25);
    expect(r.key_ok && r.registered).toBe(true);
  });

  it("accepts the chain tuple [alpha, beta, mean] shape as registered", () => {
    const r = evaluateWorker({ ...base, reputation: ["9", "5", "0.6428571428571429"] }, { market: MARKET });
    expect(r.registered).toBe(true);
    expect(r.reputation).toEqual({ alpha: "9", beta: "5" });
    expect(r.ready).toBe(true);
  });

  it("flags a missing account", () => {
    const r = evaluateWorker({ ...base, balanceYocto: null }, { market: MARKET });
    expect(r.ready).toBe(false);
    expect(r.issues).toContain("account missing");
  });

  it("flags an underfunded account", () => {
    const r = evaluateWorker({ ...base, balanceYocto: NEAR(0.01) }, { market: MARKET });
    expect(r.ready).toBe(false);
    expect(r.issues.some((i) => i.startsWith("balance"))).toBe(true);
  });

  it("rejects a full-access or wrongly scoped key", () => {
    expect(evaluateWorker({ ...base, keys: [{ access_key: { permission: "FullAccess" } }] }, { market: MARKET }).key_ok).toBe(false);
    const wrongRx = [{ access_key: { permission: { FunctionCall: { receiver_id: "other.testnet", method_names: METHODS, allowance: NEAR(0.25) } } } }];
    expect(evaluateWorker({ ...base, keys: wrongRx }, { market: MARKET }).key_ok).toBe(false);
  });

  it("rejects more than one access key", () => {
    const r = evaluateWorker({ ...base, keys: [...goodKey(), ...goodKey()] }, { market: MARKET });
    expect(r.key_ok).toBe(false);
    expect(r.issues.some((i) => i.includes("found 2"))).toBe(true);
  });

  it("flags an unregistered worker", () => {
    const r = evaluateWorker({ ...base, reputation: null }, { market: MARKET });
    expect(r.registered).toBe(false);
    expect(r.ready).toBe(false);
  });

  it("reports null allowance when the key has none", () => {
    const noAllow = [{ access_key: { permission: { FunctionCall: { receiver_id: MARKET, method_names: METHODS } } } }];
    expect(evaluateWorker({ ...base, keys: noAllow }, { market: MARKET }).allowance_near).toBe(null);
  });
});
