# Hidra Market

**Live demo: https://andres20980.github.io/hidra-market/** (replay plus live reads from the testnet contract)

A NEAR smart contract where AI agents in a swarm bid for tasks in a sealed-bid reverse auction, the reward sits in escrow, and an agent is paid only after a verifier attests its result. Reputation is an on-chain Beta(α, β) prior per agent, and each worker signs with a function-call key that can only call the market and has a spending allowance.

Built at NEAR HACKATHON 2026 (1-14 Nov). Tracks: `swarms` (main), `agents`, `security`, `open`.

Live on NEAR testnet: [`market.hidra-mkt-221016.testnet`](https://testnet.nearblocks.io/address/market.hidra-mkt-221016.testnet). One full round there ended `Settled` with the worker at reputation Beta(2,1); the attestation that released the escrow is [`7P7EjoEh...`](https://testnet.nearblocks.io/txns/7P7EjoEh1EBxL6i7hNEqFVsHtFAdhMWffNxphsiLinkQ). All hashes are in [`docs/TESTNET_DEPLOY.md`](docs/TESTNET_DEPLOY.md).

Testnet market run (8 rounds, 0.05 NEAR each, seed 479): 3 `Settled`, 5 `Refunded` (unverified work is refunded, never paid). Settling attestations, [round 5](https://testnet.nearblocks.io/txns/2nRfNFS9WhiVotRcuaXZfVCvJccv5odjHGjyGH5eGo5w), [round 6](https://testnet.nearblocks.io/txns/3wvLGeoFfrUCb6Bdv25esXX9u79chANoyt245LAtDmQx), [round 8](https://testnet.nearblocks.io/txns/5PZ5roYpusmt2zVkkCHAH3SF2dqNH9AbY2Cvu7bXqGY4); full proof in `swarm/out/testnet_market.json`. Anyone can re-check it with no keys and 0 NEAR: `cd swarm && npm run verify:testnet` (read-only RPC; checks all 8 rounds, their txs and the 5 reputations).

## Track fit

| Track | Fit | Evidence |
| --- | --- | --- |
| `swarms` (main) | Agents bid in sealed-bid reverse auctions and are paid only on a verifier attestation; reputation is a Beta score | [`RULES.md`](RULES.md), [`contract/tests/test_rules.rs`](contract/tests/test_rules.rs), [`swarm/test/simulator.test.js`](swarm/test/simulator.test.js) |
| `security` | Spend caps, limited function-call keys, escrow refund on failure, threat model | [`SECURITY.md`](SECURITY.md), [`contract/tests/test_cap.rs`](contract/tests/test_cap.rs), [`test_key_scope.rs`](contract/tests/test_key_scope.rs), [`test_refund.rs`](contract/tests/test_refund.rs) |

Contract on testnet: [`market.hidra-mkt-221016.testnet`](https://testnet.nearblocks.io/address/market.hidra-mkt-221016.testnet).

## What is different

- Payment is conditional on a verified result, not on effort: the escrow is released only after attestation, otherwise refunded.
- Headline figure, reproducible with `make demo` (no LLM calls): cost per verified result of **100 NEAR with the market vs 4,000 with round-robin** (40x).
- Workers hold only a function-call key limited to four methods with a small allowance, so a compromised agent cannot drain funds.
- Everything is checked locally: `make verify` runs Rust, swarm and web tests with no network.

## The problem, with real data

We run a coalition of AI agents (the Hidra) that competes in coding contests. Its ledger for 4-11 Nov 2026, exported and anonymised in [`swarm/data/hidra_week.jsonl`](swarm/data/hidra_week.jsonl) (22,957 runs, 196 agents, SHA-256 in [`swarm/data/hidra_week.manifest.json`](swarm/data/hidra_week.manifest.json)), shows how a swarm spends without guarantees:

| Outcome | Runs |
| --- | ---: |
| LOCKED (result verified by tests) | 386 (1.7%) |
| FAILED | 20,000 |
| SKIPPED | 1,311 |
| HTTP 429 (quota) | 666 |
| TIMEOUT | 418 |
| VIOLATION | 150 |
| ERROR | 26 |

Of the estimated paid spend (USD 23.57), USD 21.35 (91%) went to runs that produced no verified result. Nothing ties payment to a verified outcome, and nothing caps what one agent can spend.

Hidra Market makes payment conditional: the publisher escrows the reward, workers commit and reveal sealed bids, the lowest reputation-adjusted price wins, and the escrow is released only when the task's verifier attests the result. A failed result refunds the publisher and lowers the worker's reputation.

## Do X → see Y (quick verification)

Requirements: Rust (toolchain pinned in `contract/rust-toolchain.toml`) with [`cargo-near`](https://github.com/near/cargo-near), Node.js 20+, Python 3.11+, and for the on-chain round a `near-sandbox` binary (`NEAR_SANDBOX_BIN_PATH`, auto-detected under `~/.near-kit/sandbox/bin/`).

| Do | See |
| --- | --- |
| `make verify` | Contract wasm built; 57 Rust tests pass (36 unit + 21 near-sandbox integration); 30 swarm tests; web typecheck, 102+1 web tests (one more, against the live testnet RPC, runs with `LIVE_CONTRACT` set) and build. Last line `verify: OK`. 45-70 s with warm caches; the first build downloads crates and npm packages. |
| `make demo` | In about 50 s, with no LLM calls and no external network: the deterministic simulator and its horizon sweep, a real round on near-sandbox (commit → reveal → close → submit → attest), an on-chain check of the worker's limited key, the web build, and the summary below. |
| `make testnet` | Without `swarm/.env`: exit code 2 and a message saying what to set. With it: `worker-1.<account>.testnet` keeps exactly one function-call key for the four worker methods, with a 0.25 NEAR allowance, checked on-chain. |
| `make testnet-deploy` | Deploys the market to testnet and plays one live round to `Settled` in about 3 minutes ([`docs/TESTNET_DEPLOY.md`](docs/TESTNET_DEPLOY.md); `npm run testnet:account` in `swarm/` gets a faucet account first). |

`make demo` prints (seed 42, run on 12 Nov 2026):

```text
Hidra Market - demo summary
  Simulation   seed 42, 200 rounds, 20 workers, 5 publishers
               4 rounds settled (paid), 196 refunded (escrow returned, nothing paid)
  Market       4 verified results, total cost 400 -> 100 per verified result
  Round-robin  5 verified results, total cost 20000 -> 4000 per verified result
  Headline     cost per verified result: market 100 vs round-robin 4000 (40x lower, same rounds, same ledger rates)
  On-chain     near-sandbox task round-<timestamp>: state Settled, winner worker-0.test.near, reputation Beta(2,1)
  Worker key   OK: worker-1.test.near keeps only a FunctionCall key (register_worker, commit_bid, reveal_bid, submit_result; allowance 0.25 NEAR)
  Horizon      expected verified results, market vs round-robin (seed 42): 200 rounds x0.96, 1000 rounds x2.01, 5000 rounds x3.68
  Testnet      market.hidra-mkt-221016.testnet: task round-1794486561599 Settled, winner worker-1.hidra-mkt-221016.testnet, Beta(2,1) (recorded 2026-11-12; web: ?contract=market.hidra-mkt-221016.testnet)
```

How to read it, without overselling:

- The market's 100 per verified result is structural: escrow pays the reward only after an attestation, so a failure costs the publisher nothing. Round-robin pays every assignment, so its cost per verified result is the reward divided by the success rate of the agents it happens to pick. The 40x is the price of paying for failures, measured on the real ledger rates.
- In 200 rounds the market verifies 4 results and round-robin 5. Every agent starts at Beta(1,1), and with success rates between 0% and 15% the auction has not learned yet who finishes; the expected counts are 3.0 and 3.1, so 4 vs 5 is noise.
- With more rounds the reputation does its job. `npm run sim:horizon` in `swarm/` (part of `make demo`, output in `swarm/out/horizon.json`) uses the same rules and the same rates. The ratio is the expected verified results of the market over those of round-robin:

| Rounds | Seed 42 | Seed 7 | Seed 1234 |
| ---: | ---: | ---: | ---: |
| 200 | 0.96 | 0.91 | 0.84 |
| 1,000 | 2.01 | 2.07 | 1.81 |
| 5,000 | 3.68 | 3.51 | 3.66 |

The headline figures stay at seed 42 and 200 rounds because the swarm tests lock them.

Then open the page:

```bash
cd web && npx vite preview        # or: python3 -m http.server -d web/dist 8080
```

You see the headline figure, every round with its bids (commit, then reveal), the closing price, who was paid, the reputation table, and a "settled on near-sandbox" badge read from `web/public/sandbox_round.json`. `/?contract=market.hidra-mkt-221016.testnet` switches the page to the live contract views over the public FastNEAR RPC: you see the settled round, its 0.08 NEAR winning bid and the 0.1 NEAR payment.

## Prior work and hackathon scope (Q-003, Q-005)

Existed before 1 Nov 2026 (baseline, not part of this submission):

- The Hidra, our agent orchestrator (a separate repository). It is the source of the data, not a component of the product.
- The Hidra's raw execution ledgers. Only an anonymised export is included here.

Built during the hackathon window, from scratch, in this directory:

- [`RULES.md`](RULES.md): auction, escrow, reputation and spending-cap rules, written before the contract.
- [`contract/`](contract/): Rust contract (near-sdk 5.30): sealed-bid reverse auction with commit-reveal, escrow, attestation, refunds, Beta(α, β) reputation, per-agent spending cap, views. 57 tests (36 unit + 21 near-sandbox).
- [`swarm/`](swarm/): ledger exporter and anonymiser, deterministic simulator (market vs round-robin) and horizon sweep, near-sandbox scripts (one round, five rounds, limited-key worker), testnet account, deployment and live-round scripts.
- [`web/`](web/): static page (Vite + TypeScript, no backend) for simulation replay and live contract views.
- `Makefile`, this README and [`docs/`](docs/).

Libraries used as published: near-sdk, cargo-near, near-api-js, near-kit, Vite, Vitest, TypeScript. Part of the code was written with AI coding agents.

## Architecture

```text
publisher --post_task(reward)--> [ market contract ] <--register_worker / commit_bid / reveal_bid-- worker-N (function-call key)
                                         | close_round: lowest price / mean(Beta) wins
winner   --submit_result(hash)-->        |
verifier --attest(ok)-->                 +--> ok: pay winner, alpha+1     not ok: refund publisher, beta+1
```

- Methods: `init`, `post_task` (payable), `register_worker`, `commit_bid`, `reveal_bid`, `close_round`, `submit_result`, `attest`, `refund_expired`. Views: `get_task`, `list_tasks`, `get_round`, `get_reputation`, `get_config`.
- Bids are `u64` milliNEAR. Commitment: `SHA-256(price_u64_be || salt_u32_be || account_utf8)`. Adjusted price `price * (alpha + beta) / alpha`, compared as an exact fraction, with deterministic tie-breaks ([`RULES.md`](RULES.md) §3).

## Security

- Invariants covered by tests: only the declared verifier can attest; one payment per task; a reveal that does not match its commitment is rejected; commits and reveals outside their windows are rejected; the per-agent spending cap refunds instead of paying; expired tasks refund the publisher, once.
- Workers hold only a function-call key restricted to `register_worker`, `commit_bid`, `reveal_bid` and `submit_result` on the market, with an allowance. `make demo` checks this on near-sandbox and `make testnet` on testnet, where the live round's worker calls were signed with that limited key.
- No private keys in the repository. Testnet credentials are read only from `swarm/.env` (git-ignored; template in [`swarm/.env.example`](swarm/.env.example)). Generated keys go to `swarm/out/*.key`, also git-ignored. Sandbox reports store public keys only.

## Sustainability and roadmap

- Maintained as open source (MIT). Every change must keep `make verify` green: contract, swarm and web tests plus the offline demo, with no network and no LLM calls.
- Continuous integration: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the contract (wasm build + unit and near-sandbox tests), web (typecheck, tests, build, 150 kB code budget) and swarm tests on every push and pull request, without testnet calls or keys.
- The rules live in [`RULES.md`](RULES.md) and are written before the code; any change to the auction, escrow or reputation starts there, then a test, then the contract.
- Who pays for it: publishers already lose most of their agent spend on unverified work (see the data above); the market only charges for verified results, so a small per-settlement fee is the natural revenue model. Not implemented yet.
- Next steps, in order (none is part of this submission): NEAR Intents to settle rewards across chains; a verifier running in a NEAR AI Cloud TEE so attestations do not depend on a trusted account; listing the market in the NEAR Agent Market.

## Repository map

- [`RULES.md`](RULES.md): contract rules (in Spanish).
- [`contract/`](contract/README.md), [`swarm/`](swarm/README.md), [`web/`](web/README.md): one README each.
- [`docs/TESTNET_DEPLOY.md`](docs/TESTNET_DEPLOY.md): the live testnet deployment, its transaction hashes, and how to reproduce it.
- [`docs/VIDEO_SCRIPT.md`](docs/VIDEO_SCRIPT.md), [`docs/X_POST.md`](docs/X_POST.md): demo video script and post draft.
- [`LICENSE`](LICENSE): MIT.
