# swarm — simulador, replay del ledger y cliente NEAR

- `npm ci && npm test` → pruebas fijan las cifras del simulador (seed 42, 200 rondas, 20 workers, 5 publicadores).
- `npm run sim` → escribe `out/sim.json`; ves coste/verificado del mercado (100) vs round-robin (4000).
- `npm run sandbox:round` → ronda completa en near-sandbox (commit→reveal→close→submit→attest) hasta `Settled` → `out/sandbox_round.json`.
- `npm run sandbox:multi` → 5 rondas reales en near-sandbox (5 publicadores + 20 workers) → `out/multi_round.json`.
- `npm run client:sandbox` → worker-1 queda solo con key FunctionCall limitada a `register_worker,commit_bid,reveal_bid,submit_result`; ves `OK: ... solo tiene key FunctionCall`.
- `npm run verify:swarm` → todo lo anterior.
- `data/hidra_week.jsonl` → replay anónimo del ledger real; `npm run sim` → `out/sim.json` (coste/verificado mercado vs round-robin).

Sandbox: `export NEAR_SANDBOX_BIN_PATH=<ruta>/near-sandbox` si near-kit no lo descarga. Si falta, `sandbox:round` y `client:worker` hacen SKIP (exit 0) y `verify:swarm` no falla.
Testnet: credenciales solo por `.env` (ver `.env.example`).

## Dataset real (anonimo)
- `data/hidra_week.jsonl`: 22.957 lineas de los 360 ledgers reales (`copias/*/polipasto/*/ledger.jsonl`), 196 alias `worker-N` (uno por par cabeza:modelo), 3,67 MB.
- Solo estos campos: `t, worker, tipo_tarea, resultado, segundos, coste_estimado` (sin rutas, prompts, run_id ni claves).
- `resultado` = outcome real del ledger: LOCKED 386 · FAILED 20.000 · 429 666 · SKIPPED 1.311 · TIMEOUT 418 · VIOLATION 150 · ERROR 26 (solo LOCKED es exito; ver `data/hidra_week.manifest.json`).
- `coste_estimado` (USD): 0 si `cost_tier=free`; si `paid`, `segundos x 0,0002` (el ledger no trae tokens ni precio).
- `worker_rates.json` y `workers_top20.json`: tasas LOCKED por worker derivadas del dataset; alimentan el simulador.

## Cifras del simulador (semilla 42, 200 rondas, 20 workers, 5 publicadores)
- Mercado (subasta sellada inversa + escrow): 4 verificados, coste 400 -> 100 por verificado.
- Round-robin sobre los mismos datos: 5 verificados, coste 20.000 -> 4.000 por verificado (paga tambien lo no verificado).
- `npm run sandbox:multi`: 5 rondas reales en near-sandbox, 5/5 `Settled` (`out/multi_round.json`).
