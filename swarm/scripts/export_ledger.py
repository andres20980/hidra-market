#!/usr/bin/env python3
import json
from pathlib import Path
from collections import Counter, defaultdict

# Directories
LEDGERS_ROOT = Path("/home/asanchez/Code/forgejo/repositorios/hidra-conocimiento/copias")
OUTPUT_FILE = Path("/home/asanchez/Code/forgejo/repositorios/nearhackaton/producto/swarm/data/hidra_week.jsonl")

# Counters
total_lines = 0
exported_lines = 0
result_counts = Counter()

# Mapping outcome -> result
OUTCOME_MAP = {
    "LOCKED": "LOCKED",
    "RATE_LIMIT_429": "429",
    "HEAD_FAILED": "FAILED",
    "FAILED": "FAILED",
    "HEAD_TIMEOUT": "TIMEOUT",
    "SLIPPED": "SKIPPED",
    "PERIMETER_VIOLATION": "VIOLATION",
    "COMMAND_NONZERO": "ERROR",
}


def map_outcome(outcome: str) -> str:
    """Mapeo fiel al outcome real: solo LOCKED es exito; el resto NO es LOCKED."""
    return OUTCOME_MAP.get(outcome, "FAILED")

# Worker alias mapping: model -> worker index
worker_map = {}
next_worker_id = 1

def get_worker_alias(model_full: str) -> str:
    global next_worker_id
    # model_full format: "namespace/model-name" or "model-name"
    # model_full = "cabeza:modelo" (p. ej. mini-head:groq/ALLaM-2-7b): un alias
    # por par cabeza:modelo, sin filtrar ninguno de los dos componentes.
    key = model_full or "desconocido"
    if key not in worker_map:
        worker_map[key] = f"worker-{next_worker_id}"
        next_worker_id += 1
    return worker_map[key]

# Process all ledger files
ledger_files = sorted(LEDGERS_ROOT.glob("*/*/*/ledger.jsonl"))  # copias/*/polipasto/*/ledger.jsonl
print(f"Found {len(ledger_files)} ledger files")

with OUTPUT_FILE.open("w", encoding="utf-8") as out_f:
    for ledger_path in ledger_files:
        with ledger_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                total_lines += 1
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue  # skip malformed lines

                # Extract needed fields
                recorded_at = obj.get("recorded_at", "")
                head_model = obj.get("model", "") or obj.get("effective_model", "")
                outcome = obj.get("outcome", "")
                seconds = obj.get("seconds", 0)
                cost_tier = obj.get("cost_tier", "free")
                effective_model = obj.get("effective_model", "")

                # Map result
                result = map_outcome(outcome)

                # Worker alias
                worker_alias = get_worker_alias(head_model)

                # Task type (profile)
                task_type = obj.get("head_profile", "unknown")

                # Coste estimado (USD): el ledger no trae tokens ni precio, solo
                # cost_tier; para 'paid' estimamos segundos x 0,0002 USD/s.
                cost_estimated = 0.0 if cost_tier == "free" else round(float(seconds or 0) * 0.0002, 6)

                # Build record
                record = {
                    "t": recorded_at,  # timestamp
                    "worker": worker_alias,
                    "tipo_tarea": task_type,
                    "resultado": result,
                    "segundos": seconds,
                    "coste_estimado": cost_estimated,
                }
                out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                exported_lines += 1
                result_counts[result] += 1

print(f"Export completed: {exported_lines} lines written, {total_lines} lines read")
print("Result distribution:", dict(result_counts))
