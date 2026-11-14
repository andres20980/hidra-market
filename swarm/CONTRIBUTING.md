# Contributing to and maintaining the `swarm` module

A verifiable work market for AI swarms: deterministic simulator, replay of the real ledger
on NEAR testnet and on-chain client. This guide keeps the module maintainable beyond the
hackathon: how to reproduce every figure, how to extend it and what must never be touched.

## Reproduce every headline (offline, 0 NEAR, clean clone)

```sh
npm ci
npm run verify:all
```

Single gate: it chains the vitest tests, `verify:figures` (`FIGURES OK 5/5`) and
`reproduce:check` (`reproduce_checks: 6/6 OK`). It exits non-zero on the first
mismatch. It needs no NEAR account, keys or network: it is what the jury runs.

Public verification of the on-chain replay (RPC reads only, 0 NEAR, needs network):

```sh
npm run verify:testnet   # OK 8/8 rounds, 98 txs against market.hidra-mkt-221016.testnet
```

## Dataset policy (FROZEN)

`data/hidra_week.jsonl` is an anonymous replay of the real ledger and is **frozen** at its
git version for the duration of the contest. Its `sha256` and its outcome split are pinned by
`reproduce:check`. Do not regenerate `data/`, `out/`, `worker_rates.json` or `workers_top20.json`:
it breaks the published figures and the prose↔data locks. If they drift, restore them with
`git checkout HEAD -- <file>`.

## Extending the market

- **Adding a brain/worker:** its success rate comes from the real ledger in `worker_rates.json`
  (derived from the dataset, not by hand). The replay uses that LOCKED rate per worker.
- **Adding a round or baseline:** new script in `scripts/`, output in `out/*.json`, offline
  test in `test/`. Every figure printed in `README.md` must be derived from its `out/*.json`:
  `test/readme_figures.test.js` ties it and fails if text and data diverge.
- **Touching the contract:** if the message of a `require!` or a constant that the module
  publishes changes (e.g. the storage reserve), update the proof; `test/contract_source_pins.test.js`
  reads `contract/src/lib.rs` and fails if the proof diverges from the source.

## Testnet discipline (test money, still capped)

- Credentials ONLY via `.env` (template in `.env.example`); the scripts read them with
  `node --env-file=.env`. Never print or copy keys or `*.key` files.
- TOTAL budget ≤ 2.5 NEAR of testnet funds. Check the balance before spending.
- Do not redeploy the contract's state or wipe state; code-only redeploys.
- Never mainnet, never real funds, never `git push` from an agent.

## Security

- No secrets in the repo: `.env` and `*.key` are in `.gitignore`. `npm run release`
  packages without them and scans for secrets; the manifest carries the `sha256` of every file.

## Tests

`npm test` runs the full vitest suite; `npm run verify:all` is the delivery gate.
A change only counts with its real artefact and the verifier green.
