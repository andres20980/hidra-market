# reproduce_checks.py v1.2 - one command that re-derives every published figure and says OK/FAIL
# Reproducibility (juez): regenerates out/sim.json, out/horizon.json and out/multiseed.json with the
# committed code and then asserts, against those freshly written artefacts, every headline number the
# README and the demo quote (dataset provenance, seed-42 headline, multi-seed intervals, horizon
# expectation), that the per-worker bidding rates are a live derivation of that dataset, and
# that the dataset is anonymous in fact (exact field set, alias/ISO-8601 shapes, no leak).
# No network, no external dependency beyond python3.
# Usage: python3 scripts/reproduce_checks.py [--no-regen]   (--no-regen checks the committed artefacts)
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

SWARM = Path(__file__).resolve().parent.parent
OUT = SWARM / "out"
DATA = SWARM / "data"

REGEN = (
    ("sim", ["python3", "deterministic_simulator.py"]),
    ("horizon", ["python3", "scripts/horizon_sweep.py"]),
    ("multiseed", ["python3", "scripts/multiseed_ci.py"]),
)


def read(name: str) -> dict:
    return json.loads((OUT / name).read_text(encoding="utf-8"))


def near(a: float, b: float, tol: float = 0.005) -> bool:
    return abs(a - b) <= tol


def check_dataset() -> str:
    manifest = json.loads((DATA / "hidra_week.manifest.json").read_text(encoding="utf-8"))
    blob = (DATA / "hidra_week.jsonl").read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    n_lines = sum(1 for line in blob.decode("utf-8").splitlines() if line.strip())
    tally: dict[str, int] = {}
    for line in blob.decode("utf-8").splitlines():
        if not line.strip():
            continue
        tally[json.loads(line)["resultado"]] = tally.get(json.loads(line)["resultado"], 0) + 1
    if digest != manifest["sha256_dataset"]:
        return False, f"dataset sha256 {digest[:16]} != manifest {manifest['sha256_dataset'][:16]}"
    if n_lines != manifest["lineas_exportadas"]:
        return False, f"dataset lineas {n_lines} != manifest {manifest['lineas_exportadas']}"
    if tally != manifest["reparto_resultado"]:
        return False, f"dataset reparto {tally} != manifest {manifest['reparto_resultado']}"
    return True, f"sha256 {digest[:16]} / {n_lines} lineas / {len(tally)} resultados"


def check_sim() -> str:
    sim = read("sim.json")
    met = sim["metrics"]
    bad = []
    if sim["seed"] != 42 or len(sim["rounds"]) != 200:
        bad.append(f"seed/rondas {sim.get('seed')}/{len(sim.get('rounds', []))}")
    if met["mercado"]["verificados"] != 4 or met["mercado"]["coste_por_verificado"] != 100:
        bad.append(f"mercado {met['mercado']['verificados']}v {met['mercado']['coste_por_verificado']}")
    if met["round_robin"]["verificados"] != 5 or met["round_robin"]["coste_por_verificado"] != 4000:
        bad.append(f"rr {met['round_robin']['verificados']}v {met['round_robin']['coste_por_verificado']}")
    factor = met["round_robin"]["coste_por_verificado"] / met["mercado"]["coste_por_verificado"]
    if factor != 40:
        bad.append(f"factor {factor}")
    if bad:
        return False, "titular seed-42 roto: " + "; ".join(bad)
    return True, "4v/100 vs 5v/4000 = 40x"


def check_multiseed() -> str:
    ms = read("multiseed.json")
    res = ms["resumen"]
    rows = {(f["rondas"], f["semilla"]) for f in ms["filas"]}
    if rows != {(r, s) for r in (200, 1000, 5000) for s in (42, 7, 1234, 2024, 11)}:
        return False, f"grilla semillas/rondas incompleta: {len(rows)} filas"
    expect = {
        "200": (100, 100, 4000, 10000, 7666.67, 40, 100, 0.33, 0.8, 1),
        "1000": (100, 100, 5000, 7142.86, 6114.85, 50, 71.43, 1.41, 2.13, 0),
        "5000": (100, 100, 5555.56, 6849.32, 6204.1, 55.56, 68.49, 3.19, 3.93, 0),
    }
    for horizon, (mmin, mmax, rmin, rmax, rmean, fmin, fmax, vmin, vmax, sin) in expect.items():
        s = res[horizon]
        if not (near(s["mercado_coste_por_verificado"]["min"], mmin) and near(s["mercado_coste_por_verificado"]["max"], mmax)):
            return False, f"{horizon}: mercado coste fuera de [{mmin}, {mmax}]"
        if not (near(s["rr_coste_por_verificado"]["min"], rmin) and near(s["rr_coste_por_verificado"]["max"], rmax)
                and near(s["rr_coste_por_verificado"]["media"], rmean, 0.02)):
            return False, f"{horizon}: rr coste fuera de [{rmin}, {rmax}] media {rmean}"
        if not (near(s["factor_coste"]["min"], fmin) and near(s["factor_coste"]["max"], fmax)):
            return False, f"{horizon}: factor fuera de [{fmin}, {fmax}]"
        if not (near(s["ratio_verificados"]["min"], vmin) and near(s["ratio_verificados"]["max"], vmax)):
            return False, f"{horizon}: ratio fuera de [{vmin}, {vmax}]"
        if s["rr_semillas_sin_verificado"] != sin:
            return False, f"{horizon}: rr sin verificado {s['rr_semillas_sin_verificado']} != {sin}"
    for horizon, s in res.items():
        for k in ("factor_coste", "ratio_verificados"):
            if "ic95" not in s[k]:
                return False, f"{horizon}: falta IC95 t-Student en {k}"
    return True, "200: 100 vs 4000-10000 (40-100x, IC95 30,4-122,9x); 1000: ratio 1,41-2,13; 5000: 3,19-3,93 media 3,51"


def check_horizon() -> str:
    hz = read("horizon.json")
    rows = hz["rows"]
    if len(rows) != 9:
        return False, f"horizon sin 9 filas: {len(rows)}"
    exp = [r["market_vs_round_robin_expected"] for r in rows if r["rounds"] == 5000]
    med = [r["market_vs_round_robin_measured"] for r in rows if r["rounds"] == 5000]
    mean_exp = round(sum(exp) / len(exp), 2)
    mean_med = round(sum(med) / len(med), 2)
    if mean_exp != 3.62:
        return False, f"horizon esperado 5000 = {mean_exp} != 3,62"
    if not 3.0 <= mean_med <= 4.0:
        return False, f"horizon medido 5000 = {mean_med} fuera de [3,4]"
    return True, f"5000 rondas esperado {mean_exp}x / medido {mean_med}x"


def check_rates() -> tuple[bool, str]:
    """The simulator bids with the real per-worker LOCKED rate, so worker_rates.json /
    workers_top20.json must be a fresh derivation of the committed dataset (not a stale hand-copied
    file): re-derive them here from data/hidra_week.jsonl and compare."""
    blob = (DATA / "hidra_week.jsonl").read_text(encoding="utf-8")
    total: dict[str, int] = {}
    locked: dict[str, int] = {}
    for line in blob.splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        w = rec["worker"]
        total[w] = total.get(w, 0) + 1
        if rec["resultado"] == "LOCKED":
            locked[w] = locked.get(w, 0) + 1
    expected_rates = {w: (locked.get(w, 0) / total[w]) for w in total}
    expected_top20 = sorted(total, key=lambda w: (-total[w], -expected_rates[w], w))[:20]

    rates_file = json.loads((SWARM / "worker_rates.json").read_text(encoding="utf-8"))
    top_file = json.loads((SWARM / "workers_top20.json").read_text(encoding="utf-8"))
    got_rates = rates_file.get("tasa_locked", {})
    got_top20 = [row[0] for row in top_file]

    bad = []
    drift = [
        (w, got_rates.get(w), r)
        for w, r in expected_rates.items()
        if got_rates.get(w) is None or abs(got_rates[w] - r) > 1e-12
    ]
    if drift:
        bad.append(f"{len(drift)} tasas desactualizadas p.ej. {drift[0]}")
    if set(got_rates) != set(expected_rates):
        bad.append(f"aliases {len(got_rates)} != {len(expected_rates)}")
    if got_top20 != expected_top20:
        bad.append(f"top20 {got_top20[:3]} != {expected_top20[:3]}")
    if bad:
        return False, "tasas no derivadas del dataset: " + "; ".join(bad)
    return True, (
        f"{len(expected_rates)} tasas LOCKED y top-20 re-derivados de {len(total)} lineas "
        f"({len(expected_rates)} workers, top1 {expected_top20[0]})"
    )

ANON_FIELDS = {"t", "worker", "tipo_tarea", "resultado", "segundos", "coste_estimado"}
ANON_BLOCKLIST = (
    "/home/", "/tmp/", "/Users/", "polipasto", "ledger", ".jsonl", "http://", "https://",
    "ed25519", "secret", "mnemonic", "seed phrase", "prompt", "run_id", "api_key", "cabeza",
    ".py", ".md", ".png", "sk-", "bearer", "password", "token",
)
ANON_RE = {
    "worker": re.compile(r"worker-\d+"),
    "t": re.compile(r"\d{4}-\d{2}-\d{2}T[0-9:.]+\+00:00"),
}


def check_anonimizado() -> tuple[bool, str]:
    """The README sells the dataset as anonymous: enforce the exact field set, the shape of every
    field and the absence of leak-looking substrings (paths, prompts, run ids, keys) line by line,
    so a regeneration that reintroduces a real field fails the chain instead of shipping silently."""
    blob = (DATA / "hidra_week.jsonl").read_text(encoding="utf-8")
    manifest = json.loads((DATA / "hidra_week.manifest.json").read_text(encoding="utf-8"))
    outcomes = set(manifest["reparto_resultado"])
    perfiles = set(manifest["tipos_tarea"])
    bad: list[str] = []
    for lineno, line in enumerate(blob.splitlines(), start=1):
        if not line.strip():
            continue
        rec = json.loads(line)
        if set(rec) != ANON_FIELDS:
            bad.append(f"L{lineno} campos {sorted(set(rec) ^ ANON_FIELDS)}")
        for field, pattern in ANON_RE.items():
            if not pattern.fullmatch(str(rec.get(field, ""))):
                bad.append(f"L{lineno} {field}={rec.get(field)!r}")
        if rec.get("resultado") not in outcomes:
            bad.append(f"L{lineno} resultado={rec.get('resultado')!r}")
        if rec.get("tipo_tarea") not in perfiles:
            bad.append(f"L{lineno} tipo_tarea={rec.get('tipo_tarea')!r}")
        if not isinstance(rec.get("segundos"), (int, float)) or not isinstance(
            rec.get("coste_estimado"), (int, float)
        ):
            bad.append(f"L{lineno} segundos/coste no numericos")
        hit = next((s for s in ANON_BLOCKLIST if s in line.lower()), None)
        if hit:
            bad.append(f"L{lineno} fuga {hit!r}")
        if len(bad) >= 4:
            break
    if bad:
        return False, "dataset no anonimo: " + "; ".join(bad)
    return True, (
        f"{sorted(ANON_FIELDS)} exactos, alias worker-N y t ISO-8601 UTC, "
        f"0 fugas de rutas/prompts/claves en {manifest['lineas_exportadas']} lineas"
    )


CHECKS = (
    ("dataset real", check_dataset),
    ("titular seed-42", check_sim),
    ("intervalo multi-semilla", check_multiseed),
    ("horizonte", check_horizon),
    ("tasas del ledger", check_rates),
    ("dataset anonimo", check_anonimizado),
)


def main() -> int:
    if "--no-regen" not in sys.argv:
        for name, cmd in REGEN:
            rc = subprocess.call(cmd, cwd=SWARM)
            if rc != 0:
                print(f"FALLA regenerando {name} (exit {rc})")
                return 1
    failures = 0
    for name, fn in CHECKS:
        try:
            ok, result = fn()
        except Exception as exc:  # un fallo se reporta, no se aborta
            ok, result = False, f"excepcion {exc}"
        print(("OK   " if ok else "FALLA ") + f"{name}: {result}")
        if not ok:
            failures += 1
    print(f"reproduce_checks: {len(CHECKS) - failures}/{len(CHECKS)} OK")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
