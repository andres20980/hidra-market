# scripts/reproducibilidad_desde_fuente.py v1.1 - comprueba que re-exportar los ledgers fuente
# produce un hidra_week.jsonl byte-identico (mismo sha256) al commitado.
# Cierra el ciclo de reproducibilidad: ledgers fuente -> export -> dataset -> simulador -> cifras publicadas.
# Uso: python3 scripts/reproducibilidad_desde_fuente.py   (solo python3, sin red)
from __future__ import annotations

import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

SWARM = Path(__file__).resolve().parent.parent
DATASET = SWARM / "data" / "hidra_week.jsonl"
EXPORT = SWARM / "scripts" / "export_ledger.py"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    antes = sha256(DATASET)

    # Copia de seguridad en /tmp (fuera del arbol empaquetado por release).
    with tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl") as tf:
        backup = Path(tf.name)
        tf.write(DATASET.read_bytes())

    try:
        res = subprocess.run(
            [sys.executable, str(EXPORT)],
            capture_output=True, text=True, timeout=300,
        )
        if res.returncode != 0:
            print("FALLA export_ledger:", res.stderr[-500:])
            sys.exit(1)

        despues = sha256(DATASET)
        if antes == despues:
            print(f"OK dataset reproducible desde fuente: sha256 {despues[:16]}")
        else:
            print(f"FALLA dataset cambiado: antes {antes[:16]} != despues {despues[:16]}")
            DATASET.write_bytes(backup.read_bytes())
            sys.exit(1)
    finally:
        backup.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
