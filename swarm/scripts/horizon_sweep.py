# horizon_sweep.py v2.1 (escritura atomica de out/horizon.json) - market vs round-robin over longer horizons and several seeds (same rules, same ledger rates)
# The headline run (seed 42, 200 rounds) is a cold start: every worker begins at Beta(1,1). This sweep shows what the
# reputation does once it has data. "expected" sums the real ledger LOCKED rate of each assigned worker, so it is the
# noise-free number of verified results; "verified" is the seeded draw.
# v2.0: the seeded draw comes from the canonical simulator (deterministic_simulator.simulate), so R3 (cap_per_agent,
# fixed at contract init = rounds * REWARD) is applied exactly as in the headline run. v1.0 called run_round() directly
# and ignored R3, so its 5000-round figures were not reproducible by the simulator (3.69x vs 2.88x for seed 42).
# Output: out/horizon.json
from __future__ import annotations

import importlib.util
import json
import os
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
    # v2.0: ratio medido con el simulador canonico (R3 incluido) y rondas reembolsadas por el tope.
    market_vs_round_robin_measured: float | None
    cap_refunds: int


def load_simulator():
    spec = importlib.util.spec_from_file_location("deterministic_simulator", SWARM / "deterministic_simulator.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(sim, rounds: int, seed: int, workers: list[dict], rates: dict[str, float]) -> Row:
    # Cifras reales: las del simulador canonico (mismo codigo que el titular), con R3 aplicado.
    result = sim.simulate(seed, rounds)
    log = result["rounds"]
    metrics = result["metrics"]
    market_verified = metrics["mercado"]["verificados"]
    rr_verified = metrics["round_robin"]["verificados"]
    # Cifras sin ruido: tasa real del ledger del ganador de cada ronda y del trabajador del turno.
    market_expected = sum(rates.get(r.get("winner"), 0.0) for r in log)
    rr_expected = sum(rates.get(workers[(r - 1) % len(workers)]["id"], 0.0) for r in range(1, rounds + 1))
    cap_refunds = sum(1 for r in log if r.get("cap_refund"))  # R3 refunds (not the R9 failure refunds)
    measured = (market_verified / rr_verified) if rr_verified else None
    return Row(rounds, seed, market_verified, round(market_expected, 1), rr_verified, round(rr_expected, 1),
               round(market_expected / rr_expected, 2) if rr_expected else 0.0,
               round(measured, 3) if measured is not None else None, cap_refunds)


def main() -> None:
    sim = load_simulator()
    workers = sim.load_workers(str(SWARM / sim.WORKER_FILE))
    rates = sim.load_rates(str(SWARM / sim.RATES_FILE))
    rows = [run(sim, n, seed, workers, rates) for n in HORIZONS for seed in SEEDS]
    out = SWARM / "out" / "horizon.json"
    payload = {
        "workers": len(workers),
        "nota": ("market_verified/round_robin_verified: sorteo medido con el simulador canonico (R3 incluido); "
                 "market_vs_round_robin_measured: ratio medido; market_vs_round_robin_expected: ratio sin ruido "
                 "(suma de tasas reales del ledger, techo teorico); cap_refunds: rondas reembolsadas por R3 "
                 "(tope = rondas del contrato x REWARD, fijado al inicializar)"),
        "rows": [asdict(r) for r in rows],
    }
    tmp = out.with_name(out.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, out)  # atomico: ningun lector ve un horizon.json a medias
    for r in rows:
        print(f"rounds={r.rounds:5d} seed={r.seed:5d} market {r.market_verified:4d} verified (expected {r.market_expected:6.1f})"
              f" | round-robin {r.round_robin_verified:4d} (expected {r.round_robin_expected:6.1f})"
              f" | medido x{r.market_vs_round_robin_measured} | esperado x{r.market_vs_round_robin_expected}"
              f" | reembolsos R3 {r.cap_refunds}")


if __name__ == "__main__":
    main()
