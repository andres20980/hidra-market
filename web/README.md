# Web: live market page

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
- Wrong id (4xx) → message "revisa id de contrato"; unknown account → "contrato inexistente"; RPC down (5xx) → "RPC caído".

## Theme
Light/dark follows the system; force dark with `localStorage.theme = 'dark'`.

## Sandbox badge
In demo mode the page shows a "validated on near-sandbox" badge read from `public/sandbox_round.json` (copy of `swarm/out/sandbox_round.json`). Refresh it with `cp ../swarm/out/sandbox_round.json public/` after re-running the sandbox round; if the file is missing, the badge is hidden.

## Offline serving (100% local)
- Build `npm run build` copies `public/sandbox_round.json` and `public/sim.json` to `dist/`. 
- Serve offline: `python3 -m http.server -d dist 8000` → open http://localhost:8000 . No network needed; `sim.json` y `sandbox_round.json` se cargan desde `dist/`.
