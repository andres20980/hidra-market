# Web: live market page

Static Vite + TypeScript page (no backend). Shows rounds, bids (commit → reveal), closing price, who gets paid, worker reputation, and cost per verified result (market vs round-robin).

## Demo mode (simulation, no network)
- Run `npm ci && npm run build && npx vite preview` → open the printed URL → you see the headline, the rounds table and the reputation table replaying `public/sim.json`, with a speed control.
- Run `npm test` → you see all vitest suites pass (fixture loads, rounds and headline render).
- Run `npm run dev` → open http://localhost:5173 → same page with hot reload.
- Run `npm run typecheck` → no output means no TypeScript errors.
- `?sim=<url>` loads another simulation JSON (e.g. `?sim=/sim.json`).

## Live mode (testnet contract)
- Open `/?contract=<account>.testnet` → you see rounds read from the contract views via public RPC; `&rpc=<url>` overrides the endpoint.
- Wrong id (4xx) → message "revisa id de contrato"; unknown account → "contrato inexistente"; RPC down (5xx) → "RPC caído".

## Theme
Light/dark follows the system; force dark with `localStorage.theme = 'dark'`.

## Sandbox badge
In demo mode the page shows a "validated on near-sandbox" badge read from `public/sandbox_round.json` (copy of `swarm/out/sandbox_round.json`). Refresh it with `cp ../swarm/out/sandbox_round.json public/` after re-running the sandbox round; if the file is missing, the badge is hidden.
