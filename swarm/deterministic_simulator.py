#!/usr/bin/env python3
# deterministic_simulator.py v2.5 (v2.5: out/sim.json se escribe atomico tmp+os.replace:
# un lector concurrente nunca ve un JSON a medias, que era el fallo transitorio de make verify)
# Deterministic simulator implementing producto/RULES.md v1.0 (R4-R16)

import os
import json
import hashlib
from fractions import Fraction
from typing import List, Dict

# Config
WORKER_COUNT = 20
PUBLISHER_COUNT = 5
SEED = 42
ROUNDS = 200
REWARD = 100  # reward per task (fee = 0 in v1, R2)
CAP_PER_AGENT = ROUNDS * REWARD  # R3
PRIOR = (1, 1)  # Beta prior (R15)

WORKER_FILE = "workers_top20.json"
RATES_FILE = "worker_rates.json"  # real LOCKED rate per worker from ledger replay


def load_workers(file_path: str) -> List[Dict]:
    with open(file_path, "r") as f:
        raw = json.load(f)
    # Top20 format: [[id, value], ...]
    workers = []
    for entry in raw:
        if isinstance(entry, list) and len(entry) > 0:
            workers.append({"id": entry[0]})
        elif isinstance(entry, dict):
            workers.append({"id": entry.get("id", entry.get(0, ""))})
    return workers


def load_rates(file_path: str) -> Dict[str, float]:
    try:
        with open(file_path, "r") as f:
            return json.load(f).get("tasa_locked", {})
    except FileNotFoundError:
        return {}


def commit_hash(price: int, salt: int, account: str) -> str:
    # R5: sha256(price_be_u64 || salt_be_u32 || account_id_bytes)
    data = price.to_bytes(8, "big") + salt.to_bytes(4, "big") + account.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def effective_price(price: int, alpha: int, beta: int) -> Fraction:
    return Fraction(price * (alpha + beta), alpha)


def draw_success(worker_id: str, round_num: int, rate: float) -> bool:
    # deterministic draw in [0,1) from seeded sha256; worker hits per its real ledger rate
    h = int(hashlib.sha256(f"{SEED}:{worker_id}:{round_num}".encode()).hexdigest(), 16)
    return (h % 10**9) / 10**9 < rate


def run_round(workers: List[Dict], round_num: int, reputation: Dict[str, List[int]], rates: Dict[str, float]) -> Dict:
    results = {
        "round": round_num,
        "commitments": {},
        "reveals": {},
        "winner": None,
        "adjusted_prices": {},
        "state": None,
        "attest": None,
        "payment": 0,
    }

    # 1. Commit phase (R5)
    for worker in workers:
        worker_id = worker["id"]
        price = int(hashlib.sha256(f"{worker_id}{round_num}".encode()).hexdigest(), 16) % 1000 + 1
        salt = int(hashlib.sha256(f"{worker_id}{round_num+1}".encode()).hexdigest(), 16) % (2**32)
        results["commitments"][worker_id] = {
            "price": price,
            "salt": salt,
            "commitment": commit_hash(price, salt, worker_id),
        }

    # 2. Reveal phase (R6) + adjusted price (R7, per-worker Beta reputation)
    for worker in workers:
        worker_id = worker["id"]
        commit = results["commitments"].get(worker_id)
        if not commit:
            continue
        price, salt = commit["price"], commit["salt"]
        ok = commit_hash(price, salt, worker_id) == commit["commitment"]
        results["reveals"][worker_id] = {"price": price, "salt": salt, "commitment_ok": ok}
        if not ok:
            continue
        alpha, beta = reputation[worker_id]
        if alpha == 0:
            continue  # R7: media_beta == 0 -> no bid
        results["adjusted_prices"][worker_id] = float(effective_price(price, alpha, beta))

    # 3. close_round (R7 winner = min adjusted price; R8 tie-break; R9 no reveals)
    valid_workers = [wid for wid, rev in results["reveals"].items() if rev["commitment_ok"] and wid in results["adjusted_prices"]]
    if not valid_workers:
        results["state"] = "refunded"  # R9
        return results
    sorted_workers = sorted(
        valid_workers,
        key=lambda w: (
            effective_price(
                results["reveals"][w]["price"],
                reputation[w][0],
                reputation[w][1],
            ),                                        # R7: menor precio ajustado exacto
            results["reveals"][w]["price"],           # R8.1: menor precio nominal
            -(reputation[w][0] + reputation[w][1]),    # R8.2: mayor reputacion
            -reputation[w][0],                        # R8.2b: mayor alpha
            w,                                        # R8.3: cuenta menor
        ),
    )
    winner = sorted_workers[0]
    results["winner"] = winner
    results["state"] = "closed"

    # 4. R10: ganador entrega submit_result (una sola vez)
    results["submitted"] = True

    # 5. R11/R12: solo el verifier atesta; ok=true -> Settled + pago, ok=false -> Refunded
    ok = draw_success(winner, round_num, rates.get(winner, 0.0))
    results["attest"] = ok
    if ok:
        results["state"] = "settled"
        results["payment"] = REWARD  # fee = 0 en v1
        reputation[winner][0] += 1  # alpha += 1 (R12)
    else:
        results["state"] = "refunded"
        reputation[winner][1] += 1  # beta += 1 (R12 false / R14)
    return results


def simulate(seed: int = SEED, rounds: int = ROUNDS) -> Dict:
    """One full run of the market and the round-robin baseline over the same rounds,
    same ledger rates and same reward (producto/RULES.md). Pure function: the same
    (seed, rounds) always returns the same metrics. Used by main() and by the
    multi-seed interval script (scripts/multiseed_ci.py).

    R3 (cap_per_agent): the cap is fixed when the contract is initialised, so in a
    horizon sweep it belongs to the contract of that horizon: cap = rounds * REWARD.
    Keeping the 200-round cap in a 5000-round sweep refunded rounds that the rules
    would not refund (it under-stated the market: 2.95x instead of 3.51x)."""
    previous_seed = globals()["SEED"]
    globals()["SEED"] = seed  # draw_success() derives its draws from the module seed
    try:
        workers = load_workers(WORKER_FILE)
        if not workers:
            raise RuntimeError("No workers loaded, exiting.")
        rates = load_rates(RATES_FILE)
        reputation = {w["id"]: list(PRIOR) for w in workers}  # R15
        spent = {w["id"]: 0 for w in workers}  # R3
        cap = rounds * REWARD  # R3: cap_per_agent is fixed at contract init (this horizon)
        log = []
        paid = 0
        verified = 0
        for r in range(1, rounds + 1):
            round_result = run_round(workers, r, reputation, rates)
            # R3: if the payment exceeds cap - spent the round becomes Refunded.
            # Important: do not touch reputation here, run_round() already updated
            # alpha/beta for the result. The cap only voids the payment.
            if (
                round_result["state"] == "settled" and
                spent[round_result["winner"]] + round_result["payment"] > cap
            ):
                round_result["state"] = "refunded"
                round_result["payment"] = 0
                round_result["cap_refund"] = True  # R3: the cap voided a settled round
            if round_result["state"] == "settled":
                paid += round_result["payment"]
                spent[round_result["winner"]] += round_result["payment"]
                verified += 1
            log.append(round_result)
        # Baseline round-robin: metrics from the fixed rotation, not reusing the
        # market result.
        rr_verified = sum(1 for r in range(1, rounds + 1) if draw_success(
            workers[(r - 1) % len(workers)]["id"], r,
            rates.get(workers[(r - 1) % len(workers)]["id"], 0.0)))
        m_cpv = (paid / verified) if verified else None
        rr_cpv = (rounds * REWARD / rr_verified) if rr_verified else None
        return {
            "seed": seed,
            "rounds": log,
            "reputation": {k: {"alpha": v[0], "beta": v[1], "media": v[0] / (v[0] + v[1])}
                           for k, v in reputation.items()},
            "spent_by_agent": spent,
            # Metrics with explicit units so mercado and round-robin are comparable:
            # same rounds, same ledger success rates, same REWARD; only the assignment
            # rule (auction+reputation vs fixed rotation) and, for the naive baseline,
            # the payment rule differ. Each entry declares its payment rule.
            "metrics": {
                "unidad": "unidades de recompensa (REWARD=100); 1 resultado verificado = 1 attest ok=true",
                "rondas": rounds,
                "reward": REWARD,
                "mercado": {
                    "regla_asignacion": "subasta sellada inversa + reputacion Beta (R7-R8)",
                    "regla_pago": "escrow R12/R14: paga solo en Settled; fallo -> Refunded sin coste",
                    "verificados": verified,
                    "coste_total": paid,
                    "coste_por_verificado": m_cpv,
                    "verificados_por_ronda": verified / rounds,
                },
                "round_robin": {
                    "verificados": rr_verified,
                    "regla_asignacion": "rotacion fija (igual que round_robin)",
                    "regla_pago": "ingenuo: paga cada asignacion (ROUNDS*REWARD) sin escrow",
                    "coste_total": rounds * REWARD,
                    "coste_por_verificado": rr_cpv,
                    "verificados_por_ronda": rr_verified / rounds,
                },
                "titular": {
                    "definicion": "coste por resultado verificado sobre las mismas rondas y mismas tasas del ledger",
                    "mercado": m_cpv,
                    "round_robin": rr_cpv,
                    "factor_mercado_vs_rr": (rr_cpv / m_cpv) if (m_cpv and rr_cpv) else None,
                },
            },
        }
    finally:
        globals()["SEED"] = previous_seed


def main():
    sim_results = simulate()
    out_dir = "out"
    os.makedirs(out_dir, exist_ok=True)
    sim_file = os.path.join(out_dir, "sim.json")
    tmp_file = sim_file + ".tmp"
    with open(tmp_file, "w") as f:
        json.dump(sim_results, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_file, sim_file)
    print(f"Simulacion guardada en {sim_file}")


if __name__ == "__main__":
    main()
