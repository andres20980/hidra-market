# Web: live market page

Static Vite + TypeScript page (no backend). Shows rounds, bids (commit → reveal), closing price, who gets paid, worker reputation, and cost per verified result (market vs round-robin).

## Demo mode (simulation, no network)
- Run `npm ci && npm run build && npx vite preview` → open the printed URL → you see the headline, the rounds table and the reputation table replaying `public/sim.json`, with a speed control.
- Run `npm test` → you see all vitest suites pass (fixture loads, rounds and headline render).
- `?sim=<url>` loads another simulation JSON (e.g. `?sim=/sim.json`).

## Live mode (testnet contract)
- Open `/?contract=<account>.testnet` → you see rounds read from the contract views via public RPC; `&rpc=<url>` overrides the endpoint.
- Wrong id (4xx) → message "revisa id de contrato"; unknown account → "contrato inexistente"; RPC down (5xx) → "RPC caído".

## Theme
Light/dark follows the system; force dark with `localStorage.theme = 'dark'`.
