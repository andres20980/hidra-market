// scripts/testnet_costs.mjs v1.0
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { txList } from "./verify_testnet_market.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const yoctoPerNear = 10n ** 24n;
const gasPerTgas = 10n ** 12n;

export const transactionMetrics = (response) => {
  const outcomes = [
    response?.transaction_outcome?.outcome,
    ...(response?.receipts_outcome ?? []).map((r) => r?.outcome),
  ];
  if (!outcomes.length || outcomes.some((o) => !o)) throw new Error("transaction outcomes missing");
  return outcomes.reduce((total, outcome) => {
    if (!/^\d+$/.test(String(outcome.gas_burnt)) || !/^\d+$/.test(String(outcome.tokens_burnt)))
      throw new Error("transaction outcome has invalid gas_burnt or tokens_burnt");
    total.gasBurnt += BigInt(outcome.gas_burnt);
    total.tokensBurnt += BigInt(outcome.tokens_burnt);
    return total;
  }, { gasBurnt: 0n, tokensBurnt: 0n });
};

const fixed = (value, divisor, places) => {
  const scale = 10n ** BigInt(places);
  const rounded = (value * scale + divisor / 2n) / divisor;
  return `${rounded / scale}.${String(rounded % scale).padStart(places, "0")}`;
};

async function main() {
  const proofPath = resolve(process.argv[2] ?? join(here, "..", "out", "testnet_market.json"));
  const outputPath = join(here, "..", "out", "testnet_costs.json");
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
  const candidates = [proof.root, proof.verifier, ...proof.workers.map((w) => w.account_id)];
  const results = [];
  for (const round of proof.rounds) {
    let gasBurnt = 0n;
    let tokensBurnt = 0n;
    const transactions = txList(round);
    for (const tx of transactions) {
      const senders = [...new Set([tx.signer, round.winner, ...candidates].filter(Boolean))];
      let response;
      for (const sender of senders) {
        const result = await rpc("tx", {
          tx_hash: tx.hash,
          sender_account_id: sender,
          wait_until: "FINAL",
        });
        if (result?.result?.transaction_outcome) {
          response = result.result;
          break;
        }
      }
      if (!response) throw new Error(`transaction ${tx.step} could not be fetched`);
      const metrics = transactionMetrics(response);
      gasBurnt += metrics.gasBurnt;
      tokensBurnt += metrics.tokensBurnt;
    }
    results.push({ round: round.round, state: round.state, txs: transactions.length, gas_burnt: String(gasBurnt), tokens_burnt_yocto: String(tokensBurnt) });
    console.log(`round ${round.round} ${round.state} txs=${transactions.length} NEAR=${fixed(tokensBurnt, yoctoPerNear, 6)} Tgas=${fixed(gasBurnt, gasPerTgas, 3)}`);
  }
  const total = results.reduce((sum, r) => ({
    txs: sum.txs + r.txs,
    gasBurnt: sum.gasBurnt + BigInt(r.gas_burnt),
    tokensBurnt: sum.tokensBurnt + BigInt(r.tokens_burnt_yocto),
  }), { txs: 0, gasBurnt: 0n, tokensBurnt: 0n });
  const rounds = BigInt(results.length);
  const report = {
    network: proof.network,
    market: proof.market,
    source: process.argv[2] ?? "out/testnet_market.json",
    rounds: results,
    total: { txs: total.txs, gas_burnt: String(total.gasBurnt), tokens_burnt_yocto: String(total.tokensBurnt) },
    per_round_average: {
      gas_burnt: String(total.gasBurnt / rounds),
      tokens_burnt_yocto: String(total.tokensBurnt / rounds),
    },
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`TOTAL ${total.txs} txs NEAR=${fixed(total.tokensBurnt, yoctoPerNear, 6)} Tgas=${fixed(total.gasBurnt, gasPerTgas, 3)} AVG/round NEAR=${fixed(total.tokensBurnt, yoctoPerNear * rounds, 6)} Tgas=${fixed(total.gasBurnt, gasPerTgas * rounds, 3)}`);
  console.log(`saved ${outputPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`ERROR ${e.message}`); process.exit(2); });
}
