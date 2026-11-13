# build-wasm.sh v1.0 offline, no near-cli, tolerant to a read-only $HOME
set -euo pipefail
cd "$(dirname "$0")"
# near-cli and cargo-near write to $HOME/.config; point them at a writable temp dir.
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$scratch/config}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$scratch/data}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$scratch/cache}"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
export CARGO_NET_OFFLINE=true
near_builder="${CARGO_NEAR_BIN:-cargo-near}"
if [ "${near_builder}" != "none" ] && command -v "${near_builder}" >/dev/null 2>&1; then
  cargo near build non-reproducible-wasm
  wasm=target/near/contract.wasm
else
  # raw wasm (no wasm-opt): kept separate so the near-cli artefact is never overwritten
  wasm=target/wasm32-unknown-unknown/release/contract.wasm
fi
echo "wasm: $wasm $(wc -c < "$wasm") B sha256 $(sha256sum "$wasm" | cut -c1-16)"
