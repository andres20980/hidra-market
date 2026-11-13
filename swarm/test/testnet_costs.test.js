// test/testnet_costs.test.js v1.0
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { transactionMetrics } from "../scripts/testnet_costs.mjs";
import { txList } from "../scripts/verify_testnet_market.mjs";

const proof = JSON.parse(readFileSync(new URL("../out/testnet_market.json", import.meta.url), "utf8"));
const costs = JSON.parse(readFileSync(new URL("../out/testnet_costs.json", import.meta.url), "utf8"));

const fixed = (value, places) => {
  const scale = 10n ** BigInt(places);
  const v = BigInt(value);
  return `${v / scale}.${String(v % scale).padStart(places, "0")}`;
};

describe("costes RPC de testnet (offline)", () => {
  it("cubre las 98 transacciones verificadas", () => {
    expect(proof.rounds.reduce((sum, round) => sum + txList(round).length, 0)).toBe(98);
  });

  it("suma gas y tokens de la transacción y todos sus recibos con precisión entera", () => {
    expect(transactionMetrics({
      transaction_outcome: { outcome: { gas_burnt: 10, tokens_burnt: "100" } },
      receipts_outcome: [{ outcome: { gas_burnt: 20, tokens_burnt: "200" } }],
    })).toEqual({ gasBurnt: 30n, tokensBurnt: 300n });
  });

  it("el total guardado es la suma exacta de las rondas (sin pérdida de precisión)", () => {
    const sum = costs.rounds.reduce(
      (t, r) => ({ gas: t.gas + BigInt(r.gas_burnt), tok: t.tok + BigInt(r.tokens_burnt_yocto), txs: t.txs + r.txs }),
      { gas: 0n, tok: 0n, txs: 0 },
    );
    expect(sum.txs).toBe(98);
    expect(String(sum.gas)).toBe(costs.total.gas_burnt);
    expect(String(sum.tok)).toBe(costs.total.tokens_burnt_yocto);
    const rounds = BigInt(costs.rounds.length);
    expect(String(sum.gas / rounds)).toBe(costs.per_round_average.gas_burnt);
    expect(String(sum.tok / rounds)).toBe(costs.per_round_average.tokens_burnt_yocto);
  });

  it("fija la magnitud del titular de coste (evita que las cifras publicadas deriven)", () => {
    expect([fixed(costs.total.tokens_burnt_yocto, 24).slice(0, 8), fixed(costs.total.gas_burnt, 12).slice(0, 7)])
      .toEqual(["0.020573", "229.389"]);
    expect([fixed(costs.per_round_average.tokens_burnt_yocto, 24).slice(0, 8), fixed(costs.per_round_average.gas_burnt, 12).slice(0, 6)])
      .toEqual(["0.002571", "28.673"]);
  });

  it("rechaza datos incompletos o métricas inválidas", () => {
    expect(() => transactionMetrics({})).toThrow(/outcomes missing/);
    expect(() => transactionMetrics({
      transaction_outcome: { outcome: { gas_burnt: "1.5", tokens_burnt: "100" } },
    })).toThrow(/invalid/);
  });
});
