// scripts/verify_testnet_market.mjs v1.0 - read-only re-check of out/testnet_market.json against NEAR testnet.
// No keys, no writes, 0 NEAR: queries tx status of every recorded hash plus get_task/get_reputation views.
// Usage: node scripts/verify_testnet_market.mjs [proof.json]   (exit 0 only if every round matches)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const txList = (round) => {
  const out = [];
  for (const [step, v] of Object.entries(round.txs ?? {})) {
    if (typeof v === "string") out.push({ step, hash: v, signer: null });
    else for (const [acc, h] of Object.entries(v ?? {})) out.push({ step, hash: h, signer: acc });
  }
  return out;
};

export const compareRound = (round, chainTask, txStatuses) => {
  const issues = [];
  if (!chainTask) issues.push(`task ${round.task_id} not found on chain`);
  else {
    if (chainTask.state !== round.state) issues.push(`state chain=${chainTask.state} json=${round.state}`);
    if ((chainTask.winner ?? null) !== (round.winner ?? null))
      issues.push(`winner chain=${chainTask.winner} json=${round.winner}`);
    if (String(chainTask.reward) !== String(round.reward_yocto))
      issues.push(`reward chain=${chainTask.reward} json=${round.reward_yocto}`);
  }
  for (const t of txList(round)) {
    const s = txStatuses[t.hash];
    if (s !== "ok") issues.push(`tx ${t.step}${t.signer ? `:${t.signer}` : ""} ${t.hash} ${s ?? "missing"}`);
  }
  return issues;
};

export const compareReputation = (rep, chainRep) => {
  if (!chainRep) return [`reputation ${rep.account_id} missing`];
  const [alpha, beta] = chainRep;
  const issues = [];
  if (String(alpha) !== String(rep.alpha)) issues.push(`alpha chain=${alpha} json=${rep.alpha}`);
  if (String(beta) !== String(rep.beta)) issues.push(`beta chain=${beta} json=${rep.beta}`);
  return issues.map((i) => `${rep.account_id} ${i}`);
};

const outcomeOk = (r) => {
  const st = r?.result?.status;
  if (!st) return null;
  if (st.Failure) return "failed";
  const recFail = (r.result.receipts_outcome ?? []).some((o) => o.outcome?.status?.Failure);
  return recFail ? "receipt-failed" : "ok";
};

async function main() {
  const proofPath = process.argv[2] ?? join(here, "..", "out", "testnet_market.json");
  const proof = JSON.parse(readFileSync(proofPath, "utf8"));
  const rpcUrl = process.env.NEAR_RPC_URL ?? proof.rpc ?? "https://test.rpc.fastnear.com";
  const rpc = async (method, params) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status !== 429 && body?.error?.code !== -429) return body;
      if (attempt >= 5) throw new Error(`RPC ${rpcUrl} rate-limited (429)`);
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** attempt));
    }
  };
  const view = async (method_name, args) => {
    const r = await rpc("query", {
      request_type: "call_function", finality: "final", account_id: proof.market, method_name,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    return r.result ? JSON.parse(Buffer.from(r.result.result).toString("utf8")) : undefined;
  };
  const candidates = [proof.root, proof.verifier, ...proof.workers.map((w) => w.account_id)];
  const txStatus = async (hash, signer, winner) => {
    const order = [...new Set([signer, winner, ...candidates].filter(Boolean))];
    for (const sender of order) {
      const r = await rpc("tx", { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" });
      const s = outcomeOk(r);
      if (s) return s;
    }
    return "not-found";
  };

  let ok = 0;
  let ntx = 0;
  for (const round of proof.rounds) {
    const statuses = {};
    for (const t of txList(round)) statuses[t.hash] = await txStatus(t.hash, t.signer, round.winner);
    ntx += Object.keys(statuses).length;
    const issues = compareRound(round, await view("get_task", { task_id: round.task_id }), statuses);
    console.log(`round ${round.round} ${round.task_id} ${round.state} txs=${Object.keys(statuses).length} ${issues.length ? "FAIL " + issues.join("; ") : "OK"}`);
    if (!issues.length) ok++;
  }
  const repIssues = [];
  for (const rep of proof.reputations) {
    repIssues.push(...compareReputation(rep, await view("get_reputation", { account: rep.account_id })));
  }
  console.log(`reputations ${proof.reputations.length} ${repIssues.length ? "FAIL " + repIssues.join("; ") : "OK"}`);
  const allOk = ok === proof.rounds.length && !repIssues.length;
  console.log(`${allOk ? "OK" : "FAIL"} ${ok}/${proof.rounds.length} rounds, ${ntx} txs, market ${proof.market}`);
  process.exit(allOk ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(2); });
}
