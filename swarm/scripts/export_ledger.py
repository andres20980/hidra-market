#!/usr/bin/env python3
# export_ledger.py v2.0
"""Exporta los ledgers reales de la Hidra a un dataset anonimizado.

Lee:  /home/asanchez/Code/forgejo/repositorios/hidra-conocimiento/copias/*/polipasto/*/ledger.jsonl
Escribe: producto/swarm/data/hidra_week.jsonl (rama producto/swarm del repo nearhackaton)

Cada registro de salida solo contiene:
  {t, worker, tipo_tarea, resultado, segundos, coste_estimado}
- t: epoch (float) derivado de recorded_at.
- worker: alias "worker-N" asignado deterministicamente (orden sorted) al par
  (head_profile, model); el nombre del modelo nunca sale al dataset.
- tipo_tarea: head_profile (perfil de la cabeza).
- resultado: outcome (LOCKED/HEAD_FAILED/RATE_LIMIT_429/...).
- segundos: seconds del registro.
- coste_estimado: 0.0 si cost_tier == free; si es paid, seconds * TARIFF_USD_PER_S (tarifa
  por defecto, ajustable por env LEDGER_TARIFF_USD_PER_S).
Nada de rutas, run_id, plan_fingerprint, stderr_preview, providers ni claves.
"""
import glob
import hashlib
import json
import os
import sys
from datetime import datetime

LEDGERS = "/home/asanchez/Code/forgejo/repositorios/hidra-conocimiento/copias/*/polipasto/*/ledger.jsonl"
OUT = os.environ.get("SWARM_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "hidra_week.jsonl"))
TARIFF_USD_PER_S = float(os.environ.get("LEDGER_TARIFF_USD_PER_S", "0.0001"))

def epoch(recorded_at):
    try:
        return datetime.fromisoformat(recorded_at).timestamp()
    except Exception:
        return 0.0

def main():
    files = sorted(glob.glob(LEDGERS))
    if not files:
        print("BLOQUEO: no hay ledgers en", LEDGERS)
        return 1
    pairs = set()
    rows = []
    n_in = 0
    for f in files:
        with open(f, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                n_in += 1
                pair = (d.get("head_profile") or "?", d.get("model") or "?")
                pairs.add(pair)
                rows.append((d, pair))
    # alias determinista por par (head_profile, model), ordenado por hash para no filtrar orden
    order = sorted(pairs, key=lambda p: hashlib.sha256(f"{p[0]}|{p[1]}".encode()).hexdigest())
    alias = {p: f"worker-{i+1}" for i, p in enumerate(order)}
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    n_out = 0
    with open(OUT, "w", encoding="utf-8") as out:
        for d, pair in rows:
            tier = d.get("cost_tier") or "free"
            secs = d.get("seconds")
            secs = secs if isinstance(secs, (int, float)) else 0.0
            rec = {
                "t": round(epoch(d.get("recorded_at") or ""), 3),
                "worker": alias[pair],
                "tipo_tarea": d.get("head_profile") or "?",
                "resultado": d.get("outcome") or "UNKNOWN",
                "segundos": round(float(secs), 3),
                "coste_estimado": round(0.0 if tier == "free" else float(secs) * TARIFF_USD_PER_S, 8),
            }
            out.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
            n_out += 1
    print(f"ledgers={len(files)} leidas={n_in} exportadas={n_out} workers={len(alias)} out={os.path.normpath(OUT)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
