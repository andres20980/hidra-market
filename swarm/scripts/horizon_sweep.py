# horizon_sweep.py v1.0 - market vs round-robin over longer horizons and several seeds (same rules, same ledger rates)
# The headline run (seed 42, 200 rounds) is a cold start: every worker begins at Beta(1,1). This sweep shows what the
# reputation does once it has data. "expected" sums the real ledger LOCKED rate of each assigned worker, so it is the
# noise-free number of verified results; "verified" is the seeded draw. Output: out/horizon.json
from __future__ import annotations

import importlib.util
import json
from dataclasses import asdict, dataclass
from pathlib import Path

SWARM = Path(__file__).resolve().parent.parent
HORIZONS = (200, 1000, 5000)
SEEDS = (42, 7, 1234)


@dataclass
class Row:
    rounds: int
    seed: int
    market_verified: int
    market_expected: float
    round_robin_verified: int
    round_robin_expected: float
    market_vs_round_robin_expected: float


def load_simulator():
    spec = importlib.util.spec_from_file_location("deterministic_simulator", SWARM / "deterministic_simulator.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(sim, rounds: int, seed: int, workers: list[dict], rates: dict[str, float]) -> Row:
    sim.SEED = seed
    reputation = {w["id"]: list(sim.PRIOR) for w in workers}
    market_verified, market_expected = 0, 0.0
    for r in range(1, rounds + 1):
        result = sim.run_round(workers, r, reputation, rates)
        market_expected += rates.get(result["winner"], 0.0)
        market_verified += result["state"] == "settled"
    rr_verified, rr_expected = 0, 0.0
    for r in range(1, rounds + 1):
        worker = workers[(r - 1) % len(workers)]["id"]
        rr_expected += rates.get(worker, 0.0)
        rr_verified += sim.draw_success(worker, r, rates.get(worker, 0.0))
    return Row(rounds, seed, market_verified, round(market_expected, 1), rr_verified, round(rr_expected, 1),
               round(market_expected / rr_expected, 2) if rr_expected else 0.0)


def main() -> None:
    sim = load_simulator()
    workers = sim.load_workers(str(SWARM / sim.WORKER_FILE))
    rates = sim.load_rates(str(SWARM / sim.RATES_FILE))
    rows = [run(sim, n, seed, workers, rates) for n in HORIZONS for seed in SEEDS]
    out = SWARM / "out" / "horizon.json"
    out.write_text(json.dumps({"workers": len(workers), "rows": [asdict(r) for r in rows]}, indent=2) + "\n", encoding="utf-8")
    for r in rows:
        print(f"rounds={r.rounds:5d} seed={r.seed:5d} market {r.market_verified:4d} verified (expected {r.market_expected:6.1f})"
              f" | round-robin {r.round_robin_verified:4d} (expected {r.round_robin_expected:6.1f})"
              f" | x{r.market_vs_round_robin_expected}")


if __name__ == "__main__":
    main()
