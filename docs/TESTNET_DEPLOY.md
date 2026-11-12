# Testnet deployment

Testnet only. Everything runs with Node.js and `near-api-js` (no `near` CLI needed). Credentials stay in `swarm/.env` (git-ignored, mode 600); no script prints a private key.

## Live deployment (12 Nov 2026)

| Item | Value |
| --- | --- |
| Market contract | [`market.hidra-mkt-221016.testnet`](https://testnet.nearblocks.io/address/market.hidra-mkt-221016.testnet) |
| Create + fund + deploy + `init(cap_per_agent = 10 NEAR)`, one transaction | [`2qHEBo4F...`](https://testnet.nearblocks.io/txns/2qHEBo4FShgMtrLFriRLsS2zyLvUkKhKK5aVWAM6eXeB) |
| Worker key: add FunctionCall key, then delete the full-access key | [`3Entggar...`](https://testnet.nearblocks.io/txns/3Entggar1J6a3XURaLZUnjwpFVL4TydfK8Jfnkx1RHFU), [`Bycsf3oi...`](https://testnet.nearblocks.io/txns/Bycsf3oihbseVECvgYAB8mpc8Rvb58KvRMcCsRzwHJA8) |
| Round `round-1794486561599`: `post_task` (0.1 NEAR in escrow) | [`79S2Dv3k...`](https://testnet.nearblocks.io/txns/79S2Dv3kRt2Mi4wScL3r8zLmBZ5Zke1pazbPTQiXxkNr) |
| `commit_bid` / `reveal_bid` (signed with worker-1's limited key) | [`DCqdaqjQ...`](https://testnet.nearblocks.io/txns/DCqdaqjQhmT6Dbj1BztRbNLfyqbcdPDXWDFM5TEusz9U), [`3Kp7Jqid...`](https://testnet.nearblocks.io/txns/3Kp7Jqid58NTyGaK24FJnsBHFPHnqo1W99TCh4BAfrHe) |
| `close_round` / `submit_result` | [`2cYmTyn2...`](https://testnet.nearblocks.io/txns/2cYmTyn237BWpTYtsoFGGMmKCS7e5MXMvR6kJKPLcCit), [`hFcBxyB4...`](https://testnet.nearblocks.io/txns/hFcBxyB4tiBraE4xRG9bE4HNpgQbLZFeqvXqb8rcTFg) |
| `attest(ok)` by the task verifier: escrow paid, task `Settled`, worker reputation Beta(2,1) | [`7P7EjoEh...`](https://testnet.nearblocks.io/txns/7P7EjoEh1EBxL6i7hNEqFVsHtFAdhMWffNxphsiLinkQ) |

Every hash, the wasm SHA-256 and the public key of the worker are in [`swarm/out/testnet_live_proof.json`](../swarm/out/testnet_live_proof.json). The contract also holds two earlier attempts that were closed and refunded through `refund_expired`, and one left open; the proof file explains each.

Read it in the web page: `cd web && npx vite preview`, then open `/?contract=market.hidra-mkt-221016.testnet`.

## Reproduce with your own account

1. Account: `cd swarm && npm run testnet:account`. It asks the NEAR testnet faucet (the same helper that `near-cli-rs sponsor-by-faucet-service` uses) for a funded `hidra-mkt-<6 digits>.testnet`, checks it over RPC and writes `swarm/.env` with mode 600. You see `OK hidra-mkt-...: balance 10000 mNEAR`.
2. Build the contract: `make verify` (or `cd contract && cargo near build non-reproducible-wasm`).
3. Deploy and run a live round: `make testnet-deploy`. It creates `market.<account>`, deploys the wasm and calls `init` with the exact JSON bytes `{"cap_per_agent":10000000000000000000000000}` (10 NEAR in yoctoNEAR does not fit a JS number), creates `verifier.<account>`, runs `make testnet` for worker-1, then plays one round. You see `OK: round-... Settled, winner worker-1.<account>, reputation Beta(2,1)` after about 3 minutes (two 120-block windows).
4. Worker key only: `make testnet`. You see `OK worker-1.<account>: 1 key on-chain, FunctionCall to market.<account> (register_worker,commit_bid,reveal_bid,submit_result), allowance <= 0.25 NEAR`. The limited key goes to `swarm/out/worker-1.testnet.key` (mode 600, git-ignored).
5. Web: `/?contract=market.<account>.testnet` reads `list_tasks` and `get_reputation` over the public FastNEAR RPC (`&rpc=<url>` overrides it). For the demo contract, `LIVE_CONTRACT=market.hidra-mkt-221016.testnet npx vitest run test/live_testnet.test.ts` in `web/` checks the parsing against the live RPC.
