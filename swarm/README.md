# swarm — simulador, replay del ledger y cliente NEAR

- `npm ci && npm test` → pruebas fijan las cifras del simulador (seed 42, 200 rondas, 20 workers, 5 publicadores).
- `npm run sim` → escribe `out/sim.json`; ves coste/verificado del mercado (100) vs round-robin (4000).
- `npm run sandbox:round` → ronda completa en near-sandbox (commit→reveal→close→submit→attest) hasta `Settled` → `out/sandbox_round.json`.
- `npm run sandbox:multi` → 5 rondas reales en near-sandbox (5 publicadores + 20 workers) → `out/multi_round.json`.
- `npm run client:sandbox` → worker-1 queda solo con key FunctionCall limitada a `register_worker,commit_bid,reveal_bid,submit_result`; ves `OK: ... solo tiene key FunctionCall`.
- `npm run verify:swarm` → todo lo anterior.
- `npm run sim:horizon` → `out/horizon.json`: mercado frente a round-robin a 200, 1.000 y 5.000 rondas (semillas 42, 7, 1234).
- `npm run sim:multiseed` → `out/multiseed.json`: intervalo multi-semilla (5 semillas x 200/1.000/5.000 rondas) de la cifra principal.
- `npm run reproduce` (o `npm run reproduce:check` sin regenerar) → regenera `out/*.json` y comprueba dataset (sha256 y reparto), titular seed-42, intervalo multi-semilla, horizonte, que las tasas de `worker_rates.json`/`workers_top20.json` estan derivadas del dataset y que el dataset es anonimo de hecho (6/6 OK o falla con el motivo).
- `npm run release` -> `out/release/swarm-release.tar.gz`: paquete publicable sin `.env` ni `*.key` (escaneo de secretos limpio) y `out/release/manifest.json` con el sha256 de cada fichero.
- `npm run testnet:account` → cuenta testnet del faucet y `.env` (modo 600). `npm run testnet:deploy` → despliega el mercado y juega una ronda hasta `Settled` → `out/testnet_live_proof.json`.
- `npm run market:plan` → `out/market_plan.json`: preview determinista SIN red (seed 479) del mercado vivo: 5 trabajadores (cerebros reales del ledger), 8 rondas, 3 `Settled` / 5 `Refunded`, reputación Beta divergiendo (mejor worker-48 media 0,80 → precio ×1,25; peor worker-39 media 0,25 → ×4). Un juez sin cuenta NEAR reproduce la economía con un comando.
- `npm run testnet:market` → envía ESAS MISMAS rondas a `market.hidra-mkt-221016.testnet`: es un **replay del ledger real sobre la cadena real**, 5 sub-cuentas `worker-1..5` con key FunctionCall limitada, cada una con la tasa LOCKED de su cerebro; prueba pública en `out/testnet_market.json` (cuentas, hashes de tx, estados, reputaciones; sin claves). ≤2,5 NEAR.
- `data/hidra_week.jsonl` → replay anónimo del ledger real; `npm run sim` → `out/sim.json` (coste/verificado mercado vs round-robin).

Sandbox: `export NEAR_SANDBOX_BIN_PATH=<ruta>/near-sandbox` si near-kit no lo descarga. Si falta, `sandbox:round` y `client:worker` hacen SKIP (exit 0) y `verify:swarm` no falla.
Testnet: credenciales solo por `.env` (ver `.env.example`).

## Dataset real (anonimo)
- `data/hidra_week.jsonl`: 22.957 lineas de los 360 ledgers reales (`copias/*/polipasto/*/ledger.jsonl`), 196 alias `worker-N` (uno por par cabeza:modelo), 3,67 MB.
- Solo estos campos: `t, worker, tipo_tarea, resultado, segundos, coste_estimado` (sin rutas, prompts, run_id ni claves).
- `resultado` = outcome real del ledger: LOCKED 386 · FAILED 20.000 · 429 666 · SKIPPED 1.311 · TIMEOUT 418 · VIOLATION 150 · ERROR 26 (solo LOCKED es exito; ver `data/hidra_week.manifest.json`).
- `coste_estimado` (USD): 0 si `cost_tier=free`; si `paid`, `segundos x 0,0002` (el ledger no trae tokens ni precio).
- `worker_rates.json` y `workers_top20.json`: tasas LOCKED por worker derivadas del dataset (196 workers, top-20 por volumen); alimentan el simulador y `reproduce` las re-deriva cada vez para detectar que esten desactualizadas.

## Cifras del simulador (semilla 42, 200 rondas, 20 workers, 5 publicadores)
- Mercado (subasta sellada inversa + escrow): 4 verificados, coste 400 -> 100 por verificado.
- Round-robin sobre los mismos datos: 5 verificados, coste 20.000 -> 4.000 por verificado (paga tambien lo no verificado).
- `npm run sandbox:multi`: 5 rondas reales en near-sandbox, 5/5 `Settled` (`out/multi_round.json`).
- Una sola semilla es una muestra: a 200 rondas salen 1-4 verificados, asi que la cifra se declara con intervalo
  (`npm run sim:multiseed`, 5 semillas: 42, 7, 1234, 2024, 11):
  - mercado coste/verificado = 100 en las 5 semillas (el escrow R12/R14 solo paga `Settled`; un fallo es `Refunded` sin coste).
  - round-robin coste/verificado = 4.000-10.000 (media 7.667) en la misma muestra y 1 semilla con 0 verificados
    pagando 20.000 igual: el titular 40x es la semilla 42; el minimo-maximo de las semillas es 40x-100x.
  - El minimo-maximo de 5 semillas no es un intervalo: cada media lleva ademas IC95% t-Student
    (`resumen.<horizonte>.<clave>.ic95` en `out/multiseed.json`): factor coste mercado/RR 76,7x
    [30,4-122,9] a 200 rondas, 61,2x [50,9-71,4] a 1.000 y 62,0x [54,5-69,6] a 5.000; ratio de
    verificados mercado/RR 3,51x [3,13-3,89] a 5.000. Con solo 4-5 semillas el IC es ancho: ahi esta la honestidad.
  - El mercado no verifica mas que round-robin a 200 rondas (ratio 0,33-0,80x): la ventaja alli es de coste, no de exito.
  - Con reputacion suficiente si: ratio de verificados 1,41-2,13x a 1.000 rondas y media 3,51x [3,19-3,93] a 5.000
    (5 semillas: 3,69/3,19/3,47/3,27/3,93, `out/multiseed.json`).
  - A 200 rondas el mercado verifica 4 (seed 42) frente a 5 del round-robin: gana en coste (100 vs 4.000), no en volumen; la ventaja de volumen aparece a partir de 1.000 rondas.
