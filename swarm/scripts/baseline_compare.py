# baseline_compare.py v1.0 - comparacion de 3 baselines de coste por resultado verificado:
#   (1) status quo real del enjambre (ledger hidra_week.jsonl: paga TODA ejecucion),
#   (2) mismo ledger con la regla de pago del mercado (escrow: paga solo LOCKED/Settled),
#   (3) gobernanza mercado vs round-robin del simulador (out/multiseed.json, con IC95).
# Todo determinista: lee ficheros congelados en git, sin red ni azar. Salida out/baseline_compare.json.
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = ROOT / "data" / "hidra_week.jsonl"
MULTISEED = ROOT / "out" / "multiseed.json"
OUT = ROOT / "out" / "baseline_compare.json"

VERIFIED = "LOCKED"  # unico outcome que cuenta como resultado verificado (R12/R14)


def load_ledger(path: Path) -> dict:
    total = 0.0
    verified_cost = 0.0
    n = 0
    verified = 0
    by_result: dict[str, list] = {}
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            cost = rec.get("coste_estimado", 0) or 0
            res = rec["resultado"]
            n += 1
            total += cost
            agg = by_result.setdefault(res, [0, 0.0])
            agg[0] += 1
            agg[1] += cost
            if res == VERIFIED:
                verified += 1
                verified_cost += cost
    if verified == 0:
        raise SystemExit("ERROR: 0 resultados verificados en el ledger; dataset invalido")
    return {
        "n": n,
        "verificados": verified,
        "coste_total_usd": round(total, 4),
        "coste_verificados_usd": round(verified_cost, 4),
        "reparto": {k: {"n": v[0], "coste_usd": round(v[1], 4)} for k, v in sorted(by_result.items())},
    }


def build() -> dict:
    led = load_ledger(DATASET)
    n = led["n"]
    verified = led["verificados"]
    total = led["coste_total_usd"]
    verified_cost = led["coste_verificados_usd"]

    # (1) status quo: el enjambre pagó cada ejecución, fuera cual fuera el resultado.
    sq_cpv = round(total / verified, 6)
    # (2) escrow del mercado sobre los MISMOS outcomes reales: solo pagas los verificados.
    mk_cpv = round(verified_cost / verified, 6)
    waste_pct = round(100.0 * (total - verified_cost) / total, 2) if total else 0.0
    factor = round(total / verified_cost, 3) if verified_cost else None

    out = {
        "unidad": "USD estimado (coste_estimado del ledger); verificado = outcome LOCKED",
        "fuente_datos": {
            "dataset": "data/hidra_week.jsonl",
            "ejecuciones": n,
            "verificados": verified,
            "tasa_verificados_pct": round(100.0 * verified / n, 2),
        },
        "status_quo_enjambre": {
            "regla_pago": "paga toda ejecucion (sin escrow ni reputacion): lo que hace el enjambre hoy",
            "coste_total_usd": total,
            "coste_por_verificado_usd": sq_cpv,
            "gasto_no_verificado_pct": waste_pct,
        },
        "mercado_escrow_mismos_datos": {
            "regla_pago": "escrow R12/R14: paga solo resultados verificados (LOCKED); fallo -> Refunded sin coste",
            "coste_total_usd": verified_cost,
            "coste_por_verificado_usd": mk_cpv,
            "verificados": verified,
        },
        "ahorro_real": {
            "factor_coste": factor,
            "ahorro_pct": waste_pct,
            "titular": (
                f"El enjambre gastó ${total} para {verified} resultados verificados "
                f"(${sq_cpv}/verificado); con la regla de escrow del mercado sobre los mismos "
                f"outcomes habría pagado ${verified_cost} ({factor}x menos), {waste_pct}% del gasto evitado."
            ),
        },
    }

    # (3) gobernanza mercado vs round-robin del simulador, con intervalos ya calculados.
    if MULTISEED.exists():
        ms = json.loads(MULTISEED.read_text())
        resumen = ms.get("resumen", {})
        gov = {}
        for h, row in resumen.items():
            fc = row.get("factor_coste", {})
            gov[h] = {"factor_coste_media": fc.get("media"), "factor_coste_ic95": fc.get("ic95")}
        out["gobernanza_mercado_vs_round_robin"] = {
            "unidad": "unidades de recompensa del simulador (ver out/multiseed.json)",
            "nota": "subasta sellada + reputacion Beta vs rotacion fija, sobre las tasas reales del ledger",
            "por_horizonte_rondas": gov,
        }
    return out


def main() -> int:
    out = build()
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(out["ahorro_real"]["titular"])
    print(f"-> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
