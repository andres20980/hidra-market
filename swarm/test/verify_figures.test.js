// test/verify_figures.test.js v1.0
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  checkCosts,
  checkCostsCoverMarket,
  checkBaseline,
  checkAdversarial,
  checkSecurity,
  checkAll,
} from "../scripts/verify_figures.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const load = (f) => JSON.parse(readFileSync(join(outDir, f), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

describe("verify_figures: cross-check offline de la evidencia on-chain", () => {
  it("los 4 artefactos publicados son internamente consistentes", () => {
    const results = checkAll({
      costs: load("testnet_costs.json"),
      market: load("testnet_market.json"),
      baseline: load("baseline_compare.json"),
      adversarial: load("adversarial_view.json"),
      security: load("testnet_security.json"),
    });
    expect(results).toHaveLength(5);
    for (const r of results) expect(r, r.detail?.join(", ")).toMatchObject({ ok: true });
  });

  it("detecta una tx que el coste por RPC omite respecto al proof del mercado", () => {
    const c = clone(load("testnet_costs.json"));
    const m = load("testnet_market.json");
    c.rounds[0].txs -= 1;
    c.total.txs -= 1;
    expect(checkCostsCoverMarket(c, m).ok).toBe(false);
  });

  it("detecta una ronda del proof ausente en el coste por RPC", () => {
    const c = clone(load("testnet_costs.json"));
    const m = load("testnet_market.json");
    c.rounds.pop();
    expect(checkCostsCoverMarket(c, m).ok).toBe(false);
  });

  it("detecta un total de coste manipulado", () => {
    const c = clone(load("testnet_costs.json"));
    c.total.txs += 1;
    expect(checkCosts(c).ok).toBe(false);
  });

  it("detecta IC95 incoherente en la gobernanza", () => {
    const b = clone(load("baseline_compare.json"));
    b.gobernanza_mercado_vs_round_robin.por_horizonte_rondas["1000"].factor_coste_media = 999;
    expect(checkBaseline(b).ok).toBe(false);
  });

  it("detecta penalty_ratio que no deriva de worst/best", () => {
    const a = clone(load("adversarial_view.json"));
    a.worst_vs_best_price_multiplier.penalty_ratio = 1;
    expect(checkAdversarial(a).ok).toBe(false);
  });

  it("detecta ataque no rechazado", () => {
    const s = clone(load("testnet_security.json"));
    s.attack.rejected = false;
    expect(checkSecurity(s).ok).toBe(false);
  });
});
