// repricing_trace.mjs v1.0 - offline (0 NEAR, no network): replays a testnet proof round by round and shows
// how each failure raises a worker's price multiplier (alpha+beta)/alpha (RULES.md:23-24) and when it costs it the win.
import { readFileSync, writeFileSync } from "node:fs";

// Exact compare of price*(a+b)/a via cross-multiplication over BigInt (mirrors the contract's fraction compare).
const adjLess = (p1, r1, p2, r2) =>
  BigInt(p1) * (BigInt(r1.a) + BigInt(r1.b)) * BigInt(r2.a) < BigInt(p2) * (BigInt(r2.a) + BigInt(r2.b)) * BigInt(r1.a);

export const normalizeReps = (initial, workers) => {
  const reps = {};
  for (const [k, v] of Object.entries(initial)) {
    const acct = workers?.find((w) => String(w.index) === String(k))?.account_id ?? k;
    reps[acct] = { a: Number(v.alpha ?? v[0]), b: Number(v.beta ?? v[1]) };
  }
  return reps;
};

export const replayTrace = (proof) => {
  if (!proof.initial_reputations) throw new Error("proof lacks initial_reputations: replay needs the on-chain starting Beta (run f onwards)");
  const reps = normalizeReps(proof.initial_reputations, proof.reputations);
  const rounds = [];
  const mismatches = [];
  for (const r of proof.rounds) {
    const eligible = r.bidders.filter((b) => (reps[b.account_id]?.a ?? 1) > 0);
    let best = null;
    for (const b of eligible) {
      const rb = reps[b.account_id] ?? { a: 1, b: 1 };
      if (!best || adjLess(b.price, rb, best.price, reps[best.account_id] ?? { a: 1, b: 1 })) best = b;
    }
    const bids = r.bidders.map((b) => {
      const rb = reps[b.account_id] ?? { a: 1, b: 1 };
      return { account_id: b.account_id, nominal: b.price, alpha: rb.a, beta: rb.b,
        multiplier: (rb.a + rb.b) / rb.a, adjusted: (b.price * (rb.a + rb.b)) / rb.a };
    });
    const winner = r.winner;
    const wNominal = r.bidders.find((b) => b.account_id === winner)?.price;
    const undercutButLost = bids.filter((b) => b.account_id !== winner && b.nominal < wNominal).map((b) => b.account_id);
    if (best?.account_id !== winner) mismatches.push({ round: r.round, replay: best?.account_id, chain: winner });
    rounds.push({ round: r.round, state: r.state, winner, winner_nominal: wNominal, undercut_but_lost: undercutButLost, bids });
    const w = (reps[winner] ??= { a: 1, b: 1 });
    if (r.state === "Settled") w.a += 1; else if (r.state === "Refunded") w.b += 1;
  }
  const finalMismatch = (proof.reputations ?? []).filter((w) => {
    const x = reps[w.account_id];
    return !x || x.a !== Number(w.alpha) || x.b !== Number(w.beta);
  }).map((w) => w.account_id);
  const timeline = {};
  for (const r of rounds) for (const b of r.bids) (timeline[b.account_id] ??= []).push({ round: r.round, multiplier: b.multiplier });
  return { rounds, mismatches, final_reputation_mismatch: finalMismatch, multiplier_timeline: timeline,
    final_reputations: reps, ok: mismatches.length === 0 && finalMismatch.length === 0 };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = process.argv[2] ?? "out/testnet_market-f.json";
  const proof = JSON.parse(readFileSync(src, "utf8"));
  const t = replayTrace(proof);
  const out = { source: src, rule: "adjusted = nominal * (alpha+beta)/alpha; lowest adjusted wins (RULES.md:23-24)", ...t };
  const dst = src.replace(/testnet_market(-[a-z]+)?\.json$/, (_, s = "") => `repricing_trace${s}.json`);
  writeFileSync(dst, JSON.stringify(out, null, 2) + "\n");
  for (const r of t.rounds)
    console.log(`round ${r.round} ${r.state} winner=${r.winner.split(".")[0]} nominal=${r.winner_nominal} undercut_but_lost=${r.undercut_but_lost.map((a) => a.split(".")[0]).join(",") || "-"}`);
  console.log(t.ok ? `OK ${t.rounds.length}/${t.rounds.length} replay==chain -> ${dst}` : `FAIL ${JSON.stringify(t.mismatches)} ${t.final_reputation_mismatch}`);
  process.exit(t.ok ? 0 : 1);
}
