# Texto listo para integrar en el README raíz (lo aplica web/coordinadora; no edito el README raíz)

## Tercer baseline: gasto real del enjambre (reproducible, offline)

Para la sección de impacto/cifras del README raíz, una línea con el dato más fuerte (todo del dataset congelado, 0 NEAR, `cd producto/swarm && npm run baseline:compare`):

> Sobre nuestro propio ledger (22.957 ejecuciones reales), el enjambre gastó **$23,57 para 386 resultados verificados** ($0,0611 cada uno) y el **90,55 % del gasto no produjo ninguno**. La regla de escrow del mercado, aplicada a esos mismos outcomes, solo paga los verificados: **$2,23, 10,6× menos**, con el mismo número de resultados. (`out/baseline_compare.json`, test offline `test/baseline_compare.test.js`.)

Esto completa la comparación de AHORA 5(c) **mercado vs round-robin vs gasto actual del enjambre**:
- Gasto actual del enjambre (status quo, datos reales): $0,0611/verificado; 90,55 % desperdiciado.
- Mercado con escrow sobre los mismos datos: $0,00577/verificado (10,6× menos).
- Mercado vs round-robin (simulador, IC95): factor coste 62,0× a 5.000 rondas (IC95 54,5–69,6), 61,2× a 1.000 (50,9–71,4), 76,7× a 200 (30,4–122,9).

Verificación: `npm test` = 77/77 (17 ficheros); `npm run baseline:compare` imprime el titular y escribe `out/baseline_compare.json`.

## Seguridad demostrada on-chain (AHORA 4): arreglo de storage griefing en testnet

Para la sección de seguridad/implementación del README raíz:

> El arreglo contra el *storage griefing* no es una afirmación de código: se demuestra **en la cadena real**. El contrato corregido (`cargo near build` reproducible, sha256 `12f273ce…`) se redesplegó SOLO como código en `market.hidra-mkt-221016.testnet` (mismo account, sin init, sin borrar estado; code_hash `2GxmMKX1…`), y `npm run verify:testnet` siguió en `OK 8/8` con todo el estado intacto. Después, una transacción real de `submit_result` con un `result_hash` sobredimensionado (129 bytes > el máximo de 128) queda **rechazada** por el `require!` del contrato con `Smart contract panicked: Result hash length out of bounds` — tx pública `4D9PY6cTmEGYXHbKGT7vzdVcjLEzuK7TyEszcMKmk6K2` (verificable en `testnet.nearblocks.io`). El estado nunca almacena el hash sobredimensionado y un resultado válido posterior liquida la tarea (`Settled`). Prueba reproducible en `producto/swarm/out/testnet_security.json`.

Gasto on-chain de esta demostración: <0,002 NEAR de testnet (redespliegue + rondas liquidadas dentro del mercado).

## Mitigación del spam de rondas (AHORA 6): invariante de reserva de storage, live on-chain

Para la sección de seguridad/implementación del README raíz:

> Un segundo arreglo ya está desplegado en `market.hidra-mkt-221016.testnet` (código redesplegado, sha256 `770bf013…`, code_hash `91i5HZ5Q…`, tx deploy `3jzCb1cV…`; sin init ni borrado de estado, `verify:testnet` siguió en `OK 8/8`). `post_task` termina con la invariante `require_storage_reserve`: los fondos propios del contrato (saldo − escrows que aún debe) tienen que cubrir su almacenamiento estacado **más una reserva fija de 0,01 NEAR**, de modo que una ráfaga de rondas con depósito mínimo —storage que crece más rápido que su escrow de 1 yocto— se **rechaza** con `Storage reserve exhausted: would risk freezing open escrows` antes de poder congelar un pago honesto (`LackBalanceForState`). `npm run prove:round-spam` (solo lectura RPC, 0 NEAR) recomputa la invariante sobre el estado real de la cadena: margen actual **1,254735 NEAR** (~392 rondas basura hasta saltar la guarda), `guard_satisfied=true`. No se ensucia el contrato de la demo con cientos de tareas basura; el rechazo con el mensaje exacto del `require` lo produce de forma determinista el test de sandbox `contract/tests/test_round_spam.rs` (250 rondas de spam no congelan el pago honesto, que liquida en `Settled`). Prueba reproducible en `producto/swarm/out/testnet_round_spam.json` + test offline `test/round_spam_guard.test.js`. Candado de reproducibilidad añadido: `test/contract_source_pins.test.js` lee `contract/src/lib.rs` y falla si el mensaje del `require` o la constante `STORAGE_RESERVE` (0,01 NEAR) dejan de coincidir con la fuente del contrato congelado, de modo que el proof on-chain no puede divergir de lo que realmente dice el código.

Gasto on-chain de esta demostración: redespliegue de solo-código (la prueba de la invariante es 0 NEAR, solo lectura RPC).

## Escenario adversarial on-chain (AHORA 5b): el que falla paga más caro, cuantificado

Para la sección de implementación/originalidad del README raíz, con la fórmula de precio ajustado de `RULES.md:23-24`:

> La reputación Beta no es decorativa: el mercado compara **precio ajustado = precio_nominal · (α+β)/α** (fracción exacta, sin redondeo). Ese multiplicador es lo que un trabajador debe descontar de su puja para ganar. Medido **sobre la cadena real** (`npm run adversarial:view`, solo lectura, 0 NEAR), el peor trabajador del replay (`worker-4`, α=1/β=3) carga un multiplicador **4,0×** frente a **1,56×** del fiable (`worker-1`, α=9/β=5): el que falla debe pujar **2,57× más barato** para competir, o pierde. Con α=0 la puja no es siquiera elegible. Evidencia pública en `out/adversarial_view.json`, test offline `test/adversarial_view.test.js`.

- El tope por agente (`cap_per_agent` = 10 NEAR, `RULES.md:33`) acota la extracción de CADA identidad: con recompensa de 0,05 NEAR, una cuenta cobra como mucho **200 tareas** (10 NEAR); la victoria 201 se **reembolsa al publicador** (sin pago ni reputación). Cuantificado en `out/adversarial_view.json` (campo `per_agent_cap_bound`) y fijado offline en `test/adversarial_view.test.js`. No frena al operador Sybil multi-cuenta, pero cada identidad nueva arranca en Beta(1,1) (multiplicador ×2) y debe ganarse α pagando resultados verificados antes de competir con los fiables.
- Verificación: `npm test` = 77/77 (17 ficheros); `npm run adversarial:view` imprime peor/mejor/penalty_ratio y reescribe `out/adversarial_view.json` desde las vistas `get_reputation`/`get_config`.

## Reproducibilidad: un comando que valida todas las cifras publicadas (13-nov 19:30)
Para la sección de reproducibilidad del README raíz:

> Las cifras del README no se creen: se verifican. `npm run verify:figures` (offline, 0 NEAR) recomputa cada titular desde su artefacto en `out/` y falla si no cuadra: en `testnet_costs` la suma de gas/NEAR de las 8 rondas ha de igualar el total y la media = total/rondas; en `baseline_compare` el `ahorro_pct` (90,55%) ha de derivar del factor (10,586×) y la media de gobernanza caer dentro de su IC95; en `adversarial_view` el `penalty_ratio` (2,57×) ha de ser peor/mejor multiplicador con los precios ordenados; en `testnet_security` el ataque oversize ha de quedar rechazado y el resultado válido aceptado; y en `testnet_market` los 98 tx costeados por RPC coinciden exactamente con los del proof (`costs_cover_market`). Resultado 13-nov: `FIGURES OK 5/5`. El test offline `test/verify_figures.test.js` incluye casos de manipulación (total alterado, IC95 incoherente, penalty falso, ataque no rechazado, tx omitida del coste) que el verificador detecta.

- Verificación: `npm test` = 77/77 (17 ficheros); `npm run verify:figures` imprime una línea por artefacto y `FIGURES OK 5/5` (exit ≠0 si alguna cifra no deriva de su evidencia).

## Un solo comando para el jurado: `npm run verify:all` (13-nov 19:40)
Para la sección «cómo lo compruebas» del README raíz:

> Un jurado sin cuenta NEAR comprueba todo el módulo del enjambre con un solo comando, offline y determinista: `cd swarm && npm ci && npm run verify:all`. Encadena los 77 tests (vitest, 17 ficheros), `verify:figures` (cada titular recomputado desde su artefacto en `out/`: coste/round-robin/penalización/seguridad/cobertura-de-coste) y `reproduce:check` (sha256 del dataset real congelado, titular seed-42 = 40×, intervalos multi-semilla y horizonte, tasas re-derivadas del ledger, anonimato del dataset). Sale con código ≠ 0 en la primera discrepancia. Resultado 13-nov: `77 passed` · `FIGURES OK 5/5` · `reproduce_checks: 6/6 OK`.

- Verificación: `npm run verify:all` verde de extremo a extremo (0 NEAR, sin red, sin ledgers externos: solo los artefactos commiteados).

## Sostenibilidad a escala: el overhead on-chain es ~5% de lo que protege (13-nov 20:09)
Para la sección de sostenibilidad del README raíz:

> El mercado se paga solo. Medido sobre la prueba real en testnet (`npm run sustain:project`, offline, 0 NEAR), coordinar un resultado verificado on-chain (commit→reveal→close→submit→attest) cuesta **0,002572 NEAR de gas**, apenas el **5,14%** de la recompensa de 0,05 NEAR que ese resultado protege. Escala lineal: 1.000 resultados verificados = 2,572 NEAR de gas; 10.000 = 25,72 NEAR. Ese overhead compra el filtro que abarata el coste por resultado verificado **10,586×** frente a pagar cada ejecución (regla de escrow + reputación Beta sobre los mismos outcomes del ledger real). La cifra se recomputa desde `out/testnet_costs.json`, `out/testnet_market.json` y `out/baseline_compare.json` y está fijada en `test/scale_projection.test.js`.

> Y el overhead cae con el tamaño del trabajo. El gas de coordinar un resultado verificado es FIJO (0,002572 NEAR), independiente del valor de la recompensa, así que su peso relativo baja: recompensa de 0,01 NEAR → 25,7% de overhead; 0,05 → 5,14%; 0,1 → 2,57%; 0,5 → 0,51%; 1 → 0,26%. A partir de ~0,26 NEAR de recompensa el overhead on-chain baja del 1%: cuanto mayor es el trabajo que el mercado protege, más barato sale coordinarlo. Análisis de sensibilidad en `out/scale_projection.json` (campo `sensitivity`), fijado en `test/scale_projection.test.js`.

- Verificación: `npm run sustain:project` imprime el titular, las proyecciones y la tabla de sensibilidad; `npm test` = 77/77 (17 ficheros) incluye los 7 casos de `scale_projection`.

## Sostenibilidad: guía de contribución/mantenimiento (13-nov 21:40)
- `swarm/CONTRIBUTING.md`: guía concisa del módulo que lo deja mantenible tras el hackathon — reproducir cada titular (`npm run verify:all`, offline 0 NEAR), política del dataset CONGELADO, cómo añadir un cerebro/ronda/baseline, disciplina de testnet (tope 2,5 NEAR, claves solo por `.env`, sin mainnet) y seguridad (sin secretos, release escaneado).
- Candado offline `test/contributing_guide.test.js` (4 casos): cada `npm run X` citado existe en `package.json` y se conservan las reglas no negociables (puerta única, dataset congelado, tope de testnet, `.env`). Si la guía envejece, falla.
- Verde: `npm test` 77/77 (antes 73); `npm run verify:all` OK (77 vitest + FIGURES 5/5 + reproduce 6/6). 0 tx testnet.
