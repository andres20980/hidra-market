#!/usr/bin/env python3
# deterministic_simulator.py v2.1
# Deterministic simulator implementing producto/RULES.md v1.0 (R4-R16)

import os
import json
import hashlib
from typing import List, Dict

# Config
WORKER_COUNT = 20
PUBLISHER_COUNT = 5
SEED = 42
ROUNDS = 10
REWARD = 100  # reward per task (fee = 0 in v1, R2)
CAP_PER_AGENT = ROUNDS * REWARD  # R3
PRIOR = (1, 1)  # Beta prior (R15)

WORKER_FILE = "workers_top20.json"
RATES_FILE = "worker_rates.json"  # real LOCKED rate per worker from ledger replay


def load_workers(file_path: str) -> List[Dict]:
    with open(file_path, "r") as f:
        raw = json.load(f)
    return [{"id": entry[0]} for entry in raw]


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
        media_beta = alpha / (alpha + beta)
        results["adjusted_prices"][worker_id] = price / media_beta

    # 3. close_round (R7 winner = min adjusted price; R8 tie-break; R9 no reveals)
    valid_workers = [wid for wid, rev in results["reveals"].items() if rev["commitment_ok"] and wid in results["adjusted_prices"]]
    if not valid_workers:
        results["state"] = "refunded"  # R9
        return results
    sorted_workers = sorted(
        valid_workers,
        key=lambda w: (
            results["adjusted_prices"][w],           # R7: menor precio ajustado
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


def main():
    workers = load_workers(WORKER_FILE)
    if not workers:
        print("No workers loaded, exiting.")
        return
    rates = load_rates(RATES_FILE)
    reputation = {w["id"]: list(PRIOR) for w in workers}  # R15
    spent = {w["id"]: 0 for w in workers}  # R3

    sim_results = {"seed": SEED, "rounds": [], "reputation": {}, "spent_by_agent": {}, "metrics": {}}
    paid = 0
    verified = 0
    for r in range(1, ROUNDS + 1):
        round_result = run_round(workers, r, reputation, rates)
        # R3: si el pago supera cap - spent, la ronda queda Refunded
        if round_result["state"] == "settled" and spent[round_result["winner"]] + round_result["payment"] > CAP_PER_AGENT:
            round_result["state"] = "refunded"
            round_result["payment"] = 0
            reputation[round_result["winner"]][1] += 1
        if round_result["state"] == "settled":
            paid += round_result["payment"]
            spent[round_result["winner"]] += round_result["payment"]
            verified += 1
        sim_results["rounds"].append(round_result)

    # Baseline round-robin sobre los mismos datos: orden fijo, una tarea por ronda
    rr_order = [w["id"] for w in workers]
    rr_verified = sum(1 for i in range(ROUNDS) if draw_success(rr_order[i % len(rr_order)], i + 1, rates.get(rr_order[i % len(rr_order)], 0.0)))

    sim_results["reputation"] = {k: {"alpha": v[0], "beta": v[1], "media": v[0] / (v[0] + v[1])} for k, v in reputation.items()}
    sim_results["spent_by_agent"] = spent
    sim_results["metrics"] = {
        "mercado": {"coste_total": paid, "verificados": verified, "coste_por_verificado": (paid / verified) if verified else None},
        "round_robin": {"coste_total": ROUNDS * REWARD, "verificados": rr_verified, "coste_por_verificado": (ROUNDS * REWARD / rr_verified) if rr_verified else None},
    }

    out_dir = "out"
    os.makedirs(out_dir, exist_ok=True)
    sim_file = os.path.join(out_dir, "sim.json")
    with open(sim_file, "w") as f:
        json.dump(sim_results, f, indent=2)
    print(f"Simulacion guardada en {sim_file}")


if __name__ == "__main__":
    main()
