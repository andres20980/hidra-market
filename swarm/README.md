# swarm — simulador, replay del ledger y cliente NEAR

- `npm ci && npm test` → pruebas fijan las cifras del simulador (seed 42, 200 rondas, 20 workers, 5 publicadores).
- `npm run sim` → escribe `out/sim.json`; ves coste/verificado del mercado (100) vs round-robin (10000).
- `npm run sandbox:round` → ronda completa en near-sandbox (commit→reveal→close→submit→attest).
- `npm run sandbox:multi` → 5 rondas reales en near-sandbox (5 publicadores + 20 workers) → `out/multi_round.json`.
- `npm run client:sandbox` → worker-1 queda solo con key FunctionCall limitada a `register_worker,commit_bid,reveal_bid,submit_result`; ves `OK: ... solo tiene key FunctionCall`.
- `npm run verify:swarm` → todo lo anterior.
- `data/hidra_week.jsonl` → replay anónimo del ledger real; `npm run sim` → `out/sim.json` (coste/verificado mercado vs round-robin).

Sandbox: `export NEAR_SANDBOX_BIN_PATH=<ruta>/near-sandbox` si near-kit no lo descarga.
Testnet: credenciales solo por `.env` (ver `.env.example`).

## Dataset real (anonimo)
- `data/hidra_week.jsonl`: 23.782 lineas de los 339 ledgers reales (`copias/*/polipasto/*/ledger.jsonl`), 196 alias `worker-N` (uno por par cabeza:modelo), 4,6 MB.
- Solo estos campos: `t, worker, tipo_tarea, resultado, segundos, coste_estimado` (sin rutas, prompts, run_id ni claves).
- `resultado` = outcome real del ledger: LOCKED 372 · FAILED 20.869 · 429 667 · SKIPPED 1.282 · TIMEOUT 418 · VIOLATION 148 · ERROR 26 (solo LOCKED es exito).
- `coste_estimado` (USD): 0 si `cost_tier=free`; si `paid`, `segundos x 0,0002` (el ledger no trae tokens ni precio).
- `worker_rates.json` y `workers_top20.json`: tasas LOCKED por worker derivadas del dataset; alimentan el simulador.

## Cifras del simulador (semilla 42, 200 rondas, 20 workers, 5 publicadores)
- Mercado (subasta sellada inversa + escrow): 2 verificados, coste 200 -> 100 por verificado.
- Round-robin sobre los mismos datos: 2 verificados, coste 20.000 -> 10.000 por verificado (paga tambien lo no verificado).
- `npm run sandbox:multi`: 5 rondas reales en near-sandbox, 5/5 `Settled` (`out/multi_round.json`).
