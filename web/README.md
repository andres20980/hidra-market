# Web: live market page

**▶ Live demo:** https://andres20980.github.io/hidra-market/ — replays a deterministic simulated round (seed 42) plus a real testnet round, no backend. Append `?contract=market.hidra-mkt-221016.testnet` for live mode against the NEAR testnet contract.

Static Vite + TypeScript page (no backend). Shows rounds, bids (commit → reveal), closing price, who gets paid, worker reputation, and cost per verified result (market vs round-robin).

## Demo mode (simulation, no network)
- Run `npm ci && npm run build && npx vite preview` → open the printed URL → you see the headline, the rounds table and the reputation table replaying `public/sim.json`, with a speed control.
- Run `npm test` → you see all vitest suites pass (fixture loads, rounds and headline render).
- Run `npm run dev` → open http://localhost:5173 → same page with hot reload.
- Run `npm run typecheck` → no output means no TypeScript errors.
- `?sim=<url>` loads another simulation JSON (e.g. `?sim=/sim.json`).

## Live mode (testnet contract)
- Open `/?contract=market.hidra-mkt-221016.testnet` → you see the live round read from the deployed contract's views over the public FastNEAR RPC (`https://test.rpc.fastnear.com`); `&rpc=<url>` overrides the endpoint. Bids are u64 milliNEAR, rewards yoctoNEAR.
- `LIVE_CONTRACT=market.hidra-mkt-221016.testnet npx vitest run test/live_testnet.test.ts` → the same parsing against the live RPC (offline, `npm test` replays the recorded payload in `fixtures/testnet_live_views.json`).
- Wrong id (HTTP 400) → `RPC … rejected (HTTP 400) - contract id`; unknown account → `… contract does not exist`; RPC down (HTTP 503) → `… down (HTTP 503)`.

## Theme
Light/dark follows the system; force dark with `localStorage.theme = 'dark'`.

## Sandbox badge
In demo mode the page shows a "validated on near-sandbox" badge read from `public/sandbox_round.json` (copy of `swarm/out/sandbox_round.json`). Refresh it with `cp ../swarm/out/sandbox_round.json public/` after re-running the sandbox round; if the file is missing, the badge is hidden.

## Offline serving (100% local)
- Build `npm run build` copies `public/sandbox_round.json` and `public/sim.json` to `dist/`. 
- Serve offline: `python3 -m http.server -d dist 8000` → open http://localhost:8000 . No network needed; `sim.json` and `sandbox_round.json` load from `dist/`.

## Hosted demo
- Live on GitHub Pages: https://andres20980.github.io/hidra-market/ (built from `web/` by `.github/workflows/pages.yml`, official `upload-pages-artifact`/`deploy-pages` actions; relative `base: './'` so `sim.json`/`sandbox_round.json` load without a backend).
- Public repo: https://github.com/andres20980/hidra-market · author on X: [@andres_20980](https://x.com/andres_20980).

## Track fit — `swarms` (NEAR HACKATHON swarms track)
| Requirement | Where it is demonstrated |
| --- | --- |
| Sub-account per agent, every on-chain action traceable | `swarm/scripts/create_testnet_account.mjs`, `swarm/scripts/deploy_and_seed_testnet.mjs` (buyer/seller sub-accounts under one parent) |
| Coordinator contract: open round, collect sealed bids, reveal, pick winner | `contract/src/lib.rs` (commit→reveal), `cd contract && cargo test -q` |
| RULES.md written before code | [`RULES.md`](../RULES.md) (rules + one-round sequence diagram) |
| Simulation 20 workers / 5 publishers, no LLM | `cd swarm && npm run sim` (`swarm/deterministic_simulator.py` → `swarm/out/sim.json`); `swarm/test/simulator.test.js` |
| Live page: rounds, bids, clearing price, who got what | this page — demo mode replays `sim.json`; live mode reads the testnet contract (`?contract=…`); `cd web && npm test` |

## Track fit — `security` (function-call keys, spend limits, reputation)
| Requirement | Where it is demonstrated |
| --- | --- |
| Function-call keys scoped to the market, no full-access keys | `swarm/scripts/deploy_and_seed_testnet.mjs` (limited keys), [`RULES.md`](../RULES.md) |
| Per-agent spend limits / budget cap | `contract/tests/test_cap.rs`, `cargo test -q` |
| Reputation that moves the price (failing agents cost more) | `contract/src/lib.rs` reputation Beta on-chain; replayed on this page's reputation table |

## What is different
- **Real swarm ledger, counterfactual headline:** the headline recomputes our real swarm ledger (22,957 executions, 386 verified) under the escrow rule — 10.6x cheaper per verified result, 90.55 % of spend avoided. It is a recalculation of historical spend, not a measurement of the deployed swarm (see the root [README](../README.md)).
- **Reputation that moves the price:** a Beta-distributed on-chain reputation makes an agent that fails pay more on its next round; the reputation table on this page shows it shifting live.
- **Reproducible rigor, no LLM in the loop:** `RULES.md` before code, deterministic 20/5 simulation (`cd swarm && npm run sim`), sandbox-validated round badge, and a full test suite you can run offline (`web` `npm test`; `contract` `cargo test -q`; `swarm` `npm test`; all three via `make verify`).
