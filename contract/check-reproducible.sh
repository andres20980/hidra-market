#!/usr/bin/env bash
# check-reproducible.sh v1.0
# Comprueba que dos rebuilds seguidos del wasm dan bytes identicos: sirve para
# que cualquiera (jurado incluido) verifique la reproducibilidad sin mirar logs.
# Uso: ./check-reproducible.sh   (offline; usa cargo-near si esta en PATH)
set -uo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")" || exit 2
RAW=target/wasm32-unknown-unknown/release/contract.wasm   # artefacto que usa `make verify`
NEAR=target/near/contract.wasm                            # artefacto que copia near-cli
sha() { [[ -f $1 ]] && sha256sum "$1" | cut -d' ' -f1 || echo AUSENTE; }
tam() { [[ -f $1 ]] && stat -c%s "$1" || echo 0; }
anterior_raw=$(sha "$RAW"); anterior_near=$(sha "$NEAR")
anterior_tam_raw=$(tam "$RAW")
touch src/lib.rs   # solo mtime: fuerza relink sin cambiar contenido
timeout 900 cargo near build non-reproducible-wasm >/dev/null 2>&1
e1=$?
nuevo_raw=$(sha "$RAW"); nuevo_near=$(sha "$NEAR")
printf 'build1 exit=%d raw=%s B sha256=%s (anterior %s B sha256=%s)\n' \
  "$e1" "$(tam "$RAW")" "${nuevo_raw:0:16}" "$anterior_tam_raw" "${anterior_raw:0:16}"
timeout 900 cargo near build non-reproducible-wasm >/dev/null 2>&1
e2=$?
printf 'build2 exit=%d raw=%s B sha256=%s\n' "$e2" "$(tam "$RAW")" "${nuevo_raw:0:16}"
if [[ $e1 -eq 0 && $e2 -eq 0 && $nuevo_raw == "$anterior_raw" && $(sha "$RAW") == "$nuevo_raw" ]]; then
  echo "REPRODUCIBLE: raw identico en 2 builds ($(tam "$RAW") B sha256 ${nuevo_raw:0:16}); near-cli ${anterior_near:0:16} -> ${nuevo_near:0:16}"
  exit 0
fi
echo "NO REPRODUCIBLE: difiere entre builds"
exit 1
