# demo_summary.py v1.1 - print the verifiable figures produced by `make demo`
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def fresh(path: Path, since: int) -> bool:
    return path.exists() and path.stat().st_mtime >= since


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--since", type=int, required=True, help="epoch seconds when the demo started")
    args = parser.parse_args()
    out = args.root / "swarm" / "out"

    sim = load(out / "sim.json")
    metrics = sim["metrics"]
    market, naive, head = metrics["mercado"], metrics["round_robin"], metrics["titular"]
    settled = sum(1 for r in sim["rounds"] if r.get("state") == "settled")
    refunded = sum(1 for r in sim["rounds"] if r.get("state") == "refunded")

    print("")
    print("Hidra Market - demo summary")
    print(f"  Simulation   seed {sim['seed']}, {metrics['rondas']} rounds, {len(sim['reputation'])} workers, 5 publishers")
    print(f"               {settled} rounds settled (paid), {refunded} refunded (escrow returned, nothing paid)")
    print(f"  Market       {market['verificados']} verified results, total cost {market['coste_total']}"
          f" -> {market['coste_por_verificado']:g} per verified result")
    print(f"  Round-robin  {naive['verificados']} verified results, total cost {naive['coste_total']}"
          f" -> {naive['coste_por_verificado']:g} per verified result")
    print(f"  Headline     cost per verified result: market {head['mercado']:g} vs round-robin {head['round_robin']:g}"
          f" ({head['factor_mercado_vs_rr']:g}x lower, same rounds, same ledger rates)")

    sandbox = out / "sandbox_round.json"
    if fresh(sandbox, args.since):
        sb = load(sandbox)
        rep = sb.get("reputation_winner", {})
        print(f"  On-chain     near-sandbox task {sb['task_id']}: state {sb['state']}, winner {sb['winner']},"
              f" reputation Beta({rep.get('alpha')},{rep.get('beta')})")
    else:
        print("  On-chain     SKIPPED: set NEAR_SANDBOX_BIN_PATH to a near-sandbox binary to run the real round")
    worker = out / "client_worker_sandbox.json"
    if fresh(worker, args.since):
        wk = load(worker)
        status = "OK" if wk.get("ok") else "FAIL"
        print(f"  Worker key   {status}: {wk['worker']} keeps only a FunctionCall key"
              f" ({', '.join(wk['methods'])}; allowance {wk['allowance']})")

    horizon = out / "horizon.json"
    if fresh(horizon, args.since):
        rows = [r for r in load(horizon)["rows"] if r["seed"] == sim["seed"]]
        cells = ", ".join(f"{r['rounds']} rounds x{r['market_vs_round_robin_expected']:g}" for r in rows)
        print(f"  Horizon      expected verified results, market vs round-robin (seed {sim['seed']}): {cells}")

    live = out / "testnet_live_proof.json"
    if live.exists():
        lp = load(live)
        rep = lp.get("reputation_after", {})
        print(f"  Testnet      {lp['market']}: task {lp['task_id']} {lp['final']['state']},"
              f" winner {lp['final']['winner']}, Beta({rep.get('alpha')},{rep.get('beta')})"
              f" (recorded {lp['generated_at'][:10]}; web: {lp['web']})")

    print(f"  Duration     {int(time.time()) - args.since}s")
    print("  Web          cd web && npx vite preview   (or: python3 -m http.server -d web/dist 8080)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
