# multiseed_ci.py v1.2 (escritura atomica de out/multiseed.json) - multi-seed interval (min/max + desviacion + IC95 t-Student) de las cifras titular
# The headline run (seed 42, 200 rounds) is one draw. This script reruns the very same simulator
# (deterministic_simulator.simulate, same RULES.md, same ledger rates) over several seeds and
# reports min/max/mean of cost per verified result, of the market/round-robin factor and of the
# verified-result ratio, so the README and the demo can quote an interval instead of one number.
# Output: out/multiseed.json
from __future__ import annotations

import importlib.util
import json
import math
import os
from pathlib import Path

SWARM = Path(__file__).resolve().parent.parent
HORIZONS = (200, 1000, 5000)
SEEDS = (42, 7, 1234, 2024, 11)


def load_simulator():
    spec = importlib.util.spec_from_file_location("deterministic_simulator", SWARM / "deterministic_simulator.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# t critico al 97,5% (IC95% bilateral de una media) para gl = 1..20, sin dependencias.
T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
       8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145,
       15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086}


def interval(values: list) -> dict | None:
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    n = len(clean)
    mean = sum(clean) / n
    out = {
        "min": round(min(clean), 2),
        "max": round(max(clean), 2),
        "media": round(mean, 2),
        "n": n,
    }
    if n >= 2:
        var = sum((x - mean) ** 2 for x in clean) / (n - 1)
        half = T95[n - 1] * math.sqrt(var / n)
        out["desv"] = round(math.sqrt(var), 2)
        out["ic95"] = [round(mean - half, 2), round(mean + half, 2)]
    return out


def main() -> None:
    sim = load_simulator()
    rows = []
    for rounds in HORIZONS:
        for seed in SEEDS:
            m = sim.simulate(seed, rounds)["metrics"]
            market, rr = m["mercado"], m["round_robin"]
            rows.append({
                "rondas": rounds,
                "semilla": seed,
                "mercado_verificados": market["verificados"],
                "mercado_coste_total": market["coste_total"],
                "mercado_coste_por_verificado": market["coste_por_verificado"],
                "rr_verificados": rr["verificados"],
                "rr_coste_total": rr["coste_total"],
                "rr_coste_por_verificado": rr["coste_por_verificado"],
                "factor_coste": m["titular"]["factor_mercado_vs_rr"],
                "ratio_verificados": (market["verificados"] / rr["verificados"]) if rr["verificados"] else None,
            })
    resumen = {}
    for rounds in HORIZONS:
        subset = [r for r in rows if r["rondas"] == rounds]
        resumen[str(rounds)] = {
            "mercado_coste_por_verificado": interval([r["mercado_coste_por_verificado"] for r in subset]),
            "rr_coste_por_verificado": interval([r["rr_coste_por_verificado"] for r in subset]),
            "factor_coste": interval([r["factor_coste"] for r in subset]),
            "ratio_verificados": interval([r["ratio_verificados"] for r in subset]),
            # a seed where round-robin verifies nothing still pays rounds*REWARD: the interval
            # would be infinite, so it is counted instead of averaged away.
            "rr_semillas_sin_verificado": sum(1 for r in subset if r["rr_coste_por_verificado"] is None),
            "mercado_semillas_sin_verificado": sum(1 for r in subset if r["mercado_coste_por_verificado"] is None),
        }
    out = SWARM / "out" / "multiseed.json"
    tmp = out.with_name(out.name + ".tmp")
    tmp.write_text(json.dumps({"semillas": list(SEEDS), "horizontes": list(HORIZONS),
                               "filas": rows, "resumen": resumen}, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, out)  # atomico: ningun lector ve un multiseed.json a medias
    for rounds in HORIZONS:
        s = resumen[str(rounds)]
        print(f"rondas={rounds:5d} mercado cpv {s['mercado_coste_por_verificado']['media']:8.2f}"
              f" | rr cpv {s['rr_coste_por_verificado']['media']:9.2f}"
              f" [{s['rr_coste_por_verificado']['min']:.0f}-{s['rr_coste_por_verificado']['max']:.0f}]"
              f" | factor {s['factor_coste']['media']:7.2f}x"
              f" IC95 {s['factor_coste']['ic95'][0]:.2f}-{s['factor_coste']['ic95'][1]:.2f}"
              f" | ratio verificados {s['ratio_verificados']['media']:.2f}x"
              f" [{s['ratio_verificados']['min']:.2f}-{s['ratio_verificados']['max']:.2f}]"
              f" | rr sin verificado {s['rr_semillas_sin_verificado']}/{s['rr_coste_por_verificado']['n'] + s['rr_semillas_sin_verificado']}")
    print(f"intervalo multi-semilla guardado en {out}")


if __name__ == "__main__":
    main()
