// test/root_readme_figures.test.js v1.0
// Guard against prose<->data drift on the ROOT README (what the jury reads first):
// every headline number is re-derived from data/hidra_week.jsonl and out/. Offline, 0 NEAR.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const json = (p) => JSON.parse(read(p));

const README = read("../../README.md");
const raw = read("../data/hidra_week.jsonl");
const rows = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
const manifest = json("../data/hidra_week.manifest.json");
const sim = json("../out/sim.json");
const horizon = json("../out/horizon.json");
const market = json("../out/testnet_market.json");

const en = (n, places) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });

describe("cifras del README raíz respaldadas por el ledger y out/ (offline)", () => {
  it("dataset: runs, agentes y SHA-256 del manifest", () => {
    const sha = createHash("sha256").update(raw).digest("hex");
    expect(sha).toBe(manifest.sha256_dataset);
    expect(README).toContain(`${en(rows.length, 0)} runs`);
    expect(README).toContain(`${new Set(rows.map((r) => r.worker)).size} agents`);
  });

  it("tabla de outcomes = reparto recalculado del jsonl", () => {
    const by = {};
    for (const r of rows) by[r.resultado] = (by[r.resultado] ?? 0) + 1;
    const locked = by.LOCKED;
    expect(README).toContain(`| ${en(locked, 0)} (${en((100 * locked) / rows.length, 1)}%) |`);
    const label = { 429: "HTTP 429 (quota)" };
    for (const k of ["FAILED", "SKIPPED", "429", "TIMEOUT", "VIOLATION", "ERROR"]) {
      expect(README).toContain(`| ${label[k] ?? k} | ${en(by[k], 0)} |`);
    }
  });

  it("gasto pagado total, perdido y % perdido", () => {
    let total = 0;
    let lost = 0;
    for (const r of rows) {
      total += r.coste_estimado;
      if (r.resultado !== "LOCKED") lost += r.coste_estimado;
    }
    expect(README).toContain(`USD ${en(total, 2)}`);
    expect(README).toContain(`USD ${en(lost, 2)} (${Math.round((100 * lost) / total)}%)`);
  });

  it("titular 100 vs 4,000 (40x) y 4 vs 5 verificados = out/sim.json", () => {
    const m = sim.metrics;
    expect(sim.seed).toBe(42);
    expect(README).toContain(
      `**${en(m.titular.mercado, 0)} NEAR with the market vs ${en(m.titular.round_robin, 0)} with round-robin** (${m.titular.factor_mercado_vs_rr}x)`,
    );
    expect(README).toContain(
      `In ${m.rondas} rounds the market verifies ${m.mercado.verificados} results and round-robin ${m.round_robin.verificados}`,
    );
  });

  it("horizonte esperado 0.96/2.01/3.68 = out/horizon.json", () => {
    const parts = horizon.rows
      .filter((r) => r.seed === 42)
      .map((r) => `${r.rounds} rounds x${en(r.market_vs_round_robin_expected, 2)}`);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const p of parts) expect(README).toContain(p);
  });

  it("prueba testnet: rondas, Settled y Refunded = out/testnet_market.json", () => {
    expect(README).toContain(
      `${market.rounds.length} rounds, 0.05 NEAR each, seed ${market.seed}): ${market.settled_count} \`Settled\`, ${market.refunded_count} \`Refunded\``,
    );
  });
});
