# Contribuir y mantener el módulo `swarm`

Mercado verificable de trabajo para enjambres de IA: simulador determinista, replay del
ledger real sobre NEAR testnet y cliente on-chain. Esta guía deja el módulo mantenible más
allá del hackathon: cómo reproducir cada cifra, cómo extenderlo y qué nunca se toca.

## Reproducir cada titular (offline, 0 NEAR, clon limpio)

```sh
npm ci
npm run verify:all
```

Puerta única: encadena los tests de vitest, `verify:figures` (`FIGURES OK 5/5`) y
`reproduce:check` (`reproduce_checks: 6/6 OK`). Falla con código ≠ 0 en la primera
discrepancia. No necesita cuenta NEAR, claves ni red: es lo que ejecuta el jurado.

Verificación pública del replay on-chain (solo lectura RPC, 0 NEAR, requiere red):

```sh
npm run verify:testnet   # OK 8/8 rounds, 98 txs contra market.hidra-mkt-221016.testnet
```

## Política del dataset (CONGELADO)

`data/hidra_week.jsonl` es un replay anónimo del ledger real y está **congelado** en su
versión de git durante el concurso. Su `sha256` y su reparto por resultado los fija
`reproduce:check`. No regeneres `data/`, `out/`, `worker_rates.json` ni `workers_top20.json`:
rompe las cifras publicadas y los candados prosa↔datos. Si derivan, restáuralos con
`git checkout HEAD -- <fichero>`.

## Extender el mercado

- **Añadir un cerebro/worker:** su tasa de éxito sale del ledger real en `worker_rates.json`
  (derivado del dataset, no a mano). El replay usa esa tasa LOCKED por worker.
- **Añadir una ronda o baseline:** script nuevo en `scripts/`, salida en `out/*.json`, test
  offline en `test/`. Toda cifra impresa en `README.md` ha de derivarse de su `out/*.json`:
  `test/readme_figures.test.js` la ata y falla si texto y dato divergen.
- **Tocar el contrato:** si cambia el mensaje de un `require!` o una constante que el módulo
  publica (p. ej. la reserva de storage), actualiza el proof; `test/contract_source_pins.test.js`
  lee `contract/src/lib.rs` y falla si el proof diverge de la fuente.

## Disciplina de testnet (dinero de prueba, aun así acotado)

- Credenciales SOLO por `.env` (plantilla en `.env.example`); los scripts las leen con
  `node --env-file=.env`. Nunca imprimas ni copies claves ni `*.key`.
- Presupuesto TOTAL ≤ 2,5 NEAR de testnet. Mira el saldo antes de gastar.
- No redespliegues el estado del contrato ni borres estado; redespliegue solo de código.
- Nunca mainnet, nunca fondos reales, nunca `git push` desde un agente.

## Seguridad

- Sin secretos en el repo: `.env` y `*.key` están en `.gitignore`. `npm run release`
  empaqueta sin ellos y escanea secretos; el manifiesto lleva el `sha256` de cada fichero.

## Tests

`npm test` corre la suite vitest completa; `npm run verify:all` es la puerta de entrega.
Un cambio solo cuenta con su artefacto real y el verificador en verde.
