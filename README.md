<!-- README.md v1.1 -->
# Hidra Market

AI agents bid sealed on NEAR and are paid only after a verifier attests. Counterfactual on 22,957 real runs of our swarm: 10.6x cheaper per verified result.

## For judges (60 s)


Hidra Market: sealed reverse auctions with on-chain escrow and Beta reputation; agents paid only after a verifier attests. Live demo: https://andres20980.github.io/hidra-market/?contract=market.hidra-mkt-221016.testnet · testnet tx (round Settled): https://testnet.nearblocks.io/txns/2nRfNFS9WhiVotRcuaXZfVCvJccv5odjHGjyGH5eGo5w · video: link when published. No wallet, NEAR, or testnet needed:

```sh
make verify
```

Limits: NEAR testnet only; not independently audited; the proposed 2% market fee is not implemented.


A NEAR smart contract where AI agents in a swarm bid for tasks in a sealed-bid reverse auction, the reward sits in escrow, and an agent is paid only after a verifier attests its result. Each agent's reputation is an on-chain Beta(α, β) score updated on every verified or failed delivery, and each worker signs with a function-call key that can only call the market and has a spending allowance.

Built at NEAR HACKATHON 2026 (1-14 Nov). Tracks: `swarms` (main), `security`, `agents` (each justified in the table below).

Live on NEAR testnet: [`market.hidra-mkt-221016.testnet`](https://testnet.nearblocks.io/address/market.hidra-mkt-221016.testnet). One full round there ended `Settled` with the worker at reputation Beta(2,1); the attestation that released the escrow is the testnet tx linked in the 60 s block above. All hashes are in [`docs/TESTNET_DEPLOY.md`](docs/TESTNET_DEPLOY.md).

Testnet market run (8 rounds, 0.05 NEAR each, seed 479): 3 `Settled`, 5 `Refunded` (unverified work is refunded, never paid). Attestations that settled them: [round 5](https://testnet.nearblocks.io/txns/2nRfNFS9WhiVotRcuaXZfVCvJccv5odjHGjyGH5eGo5w), [round 6](https://testnet.nearblocks.io/txns/3wvLGeoFfrUCb6Bdv25esXX9u79chANoyt245LAtDmQx), [round 8](https://testnet.nearblocks.io/txns/5PZ5roYpusmt2zVkkCHAH3SF2dqNH9AbY2Cvu7bXqGY4); full proof in `swarm/out/testnet_market.json`. The third command in the 60 s block above re-checks all 8 rounds, their txs and the 5 reputations over a read-only public RPC: no keys, 0 NEAR.

## Track fit

| Track | Fit | Evidence |
| --- | --- | --- |
| `swarms` (main) | Agents bid in sealed-bid reverse auctions and are paid only on a verifier attestation; reputation is a Beta score | [`RULES.md`](RULES.md), [`contract/tests/test_rules.rs`](contract/tests/test_rules.rs), [`swarm/test/simulator.test.js`](swarm/test/simulator.test.js) |
| `security` | Spend caps, limited function-call keys, escrow refund on failure, threat model | [`SECURITY.md`](SECURITY.md), [`contract/tests/test_cap.rs`](contract/tests/test_cap.rs), [`test_key_scope.rs`](contract/tests/test_key_scope.rs), [`test_refund.rs`](contract/tests/test_refund.rs) |
| `agents` | Worker agents earn by bidding and delivering: each holds only a market-scoped function-call key, and the winner is paid the escrowed reward on attestation (3 of 8 testnet rounds paid a worker, 5 refunded) | [`contract/src/lib.rs:409`](contract/src/lib.rs), [`swarm/scripts/client_worker.mjs`](swarm/scripts/client_worker.mjs), [`swarm/out/testnet_market.json`](swarm/out/testnet_market.json) |

## What is different

- Payment is conditional on a verified result, not on effort: the escrow is released only after attestation, otherwise refunded.
- Headline figure: **10.6x cheaper per verified result, counterfactual on our real swarm ledger (22,957 runs)**. We apply the escrow rule (pay only attested results) to the same historical outcomes; it is a recalculation of real spend, not a measurement of the deployed swarm. The swarm spent an estimated USD 23.5734 (per-run estimated cost field in the ledger; 74% of runs are logged at zero cost, e.g. free-tier models) for 386 verified results (USD 0.061071 each); paying only verified results through escrow, the same outcomes cost USD 2.2268 (USD 0.005769 each), 10.586x less and 90.55% of the spend avoided. Reproduce offline: `cd swarm && npm run baseline:compare` (writes `swarm/out/baseline_compare.json`).
- Simulated benchmark scenario (`make demo`, seed 42, no LLM calls): cost per verified result of **100 NEAR with the market vs 4,000 with round-robin** (40x), in simulator reward units, not the headline.
- Workers hold only a function-call key limited to four methods with a small allowance, so a compromised agent cannot drain funds.
- Adversarial cases are pinned by sandbox tests: a copied commitment cannot front-run another worker's bid ([`test_commit_front_run.rs`](contract/tests/test_commit_front_run.rs)); a storage-reserve invariant rejects registration and commit spam before it can consume the funds backing open escrows (it does not prevent Sybil identities) ([`test_storage_griefing.rs`](contract/tests/test_storage_griefing.rs), [`test_registration_spam.rs`](contract/tests/test_registration_spam.rs)); bids are capped at 512 per task so `close_round` stays within gas ([`test_close_round_many_bids.rs`](contract/tests/test_close_round_many_bids.rs)). Disclosed limit: there is no bid bond, so a Sybil bid ladder can reveal selectively ([`SECURITY.md`](SECURITY.md), [`test_selective_reveal_ladder.rs`](contract/tests/test_selective_reveal_ladder.rs)). Testnet only, not audited.
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

Requirements: Rust (toolchain pinned in `contract/rust-toolchain.toml`) with [`cargo-near`](https://github.com/near/cargo-near), Node.js 22+ (Node 20.19+ also works: tests and the sandbox round pass, but npm prints an EBADENGINE warning because near-api-js 7.4 declares node >=22.22), Python 3.11+, and for the on-chain round a `near-sandbox` binary (`NEAR_SANDBOX_BIN_PATH`, auto-detected under `~/.near-kit/sandbox/bin/`).

| Do | See |
| --- | --- |
| `make verify` | Contract wasm built; 111 Rust tests pass (38 unit + 73 integration tests across 42 files (24 near-sandbox + 49 mock-VM)); 113+1 swarm tests (one more rebuilds the ledger from the source runs, which live outside this repo; it runs with `HIDRA_LEDGERS_ROOT` set); web typecheck, 179+1 web tests (one more, against the live testnet RPC, runs with `LIVE_CONTRACT` set) and build. Last line `verify: OK`. About 10 min with warm caches (the near-sandbox suites dominate, ~585 s measured); the first build downloads crates and npm packages. |
| `make demo` | In about 50 s, with no LLM calls and no external network: the deterministic simulator and its horizon sweep, a real round on near-sandbox (commit → reveal → close → submit → attest), an on-chain check of the worker's limited key, the web build, and the summary below. |
| `make testnet` | Without `swarm/.env`: exit code 2 and a message saying what to set. With it: `worker-1.<account>.testnet` keeps exactly one function-call key for the four worker methods, with a 0.25 NEAR allowance, checked on-chain. |
| `make testnet-deploy` | Deploys the market to testnet and plays one live round to `Settled` in about 3 minutes ([`docs/TESTNET_DEPLOY.md`](docs/TESTNET_DEPLOY.md); `npm run testnet:account` in `swarm/` gets a faucet account first). |

`make demo` prints (simulated benchmark scenario, seed 42; the 100 vs 4000 below is simulated; the headline 10.6x is the counterfactual on the real ledger described above):

```text
Hidra Market - demo summary
  Headline     10.6x cheaper per verified result (counterfactual on real swarm ledger, 22,957 runs)
  Scenario     simulated benchmark scenario (reward units, not measured spend)
  Simulation   seed 42, 200 rounds, 20 workers, 5 publishers
               4 rounds settled (paid), 196 refunded (escrow returned, nothing paid)
  Market       4 verified results, total cost 400 -> 100 per verified result
  Round-robin  5 verified results, total cost 20000 -> 4000 per verified result
  Benchmark    simulated benchmark scenario: market 100 vs round-robin 4000 (40x lower, same rounds, same ledger rates)
  On-chain     near-sandbox task round-<timestamp>: state Settled, winner worker-0.test.near, reputation Beta(2,1)
  Worker key   OK: worker-1.test.near keeps only a FunctionCall key (register_worker, commit_bid, reveal_bid, submit_result; allowance 0.25 NEAR)
  Horizon      expected verified results, market vs round-robin (seed 42): 200 rounds x0.96, 1000 rounds x2.01, 5000 rounds x3.68
  Testnet      market.hidra-mkt-221016.testnet: task round-1794486561599 Settled, winner worker-1.hidra-mkt-221016.testnet, Beta(2,1) (recorded 2026-11-12; web: ?contract=market.hidra-mkt-221016.testnet)
```

How to read it, without overselling:

- The market's 100 per verified result is structural: escrow pays the reward only after an attestation, so a failure costs the publisher nothing. Round-robin pays every assignment, so its cost per verified result is the reward divided by the success rate of the agents it happens to pick. The 40x simulated benchmark scenario illustrates paying for failures at the real ledger success rates; the headline 10.6x recomputes the real historical spend under the escrow rule (counterfactual), not from the simulator.
- In 200 rounds the market verifies 4 results and round-robin 5. Every agent starts at Beta(1,1), and with success rates between 0% and 15% the auction has not learned yet who finishes; the expected counts are 3.0 and 3.1, so 4 vs 5 is noise.
- With more rounds the reputation does its job. `npm run sim:horizon` in `swarm/` (part of `make demo`, output in `swarm/out/horizon.json`) uses the same rules and the same rates. The ratio is the expected verified results of the market over those of round-robin:

| Rounds | Seed 42 | Seed 7 | Seed 1234 |
| ---: | ---: | ---: | ---: |
| 200 | 0.96 | 0.91 | 0.84 |
| 1,000 | 2.01 | 2.07 | 1.81 |
| 5,000 | 3.68 | 3.51 | 3.66 |

The demo figures above stay at seed 42 and 200 rounds because the swarm tests lock them.

Then open the page:

```bash
cd web && npx vite preview        # or: python3 -m http.server -d web/dist 8080
```

You see the headline figure, every round with its bids (commit, then reveal), the closing price, who was paid, the reputation table, and a "settled on near-sandbox" badge read from `web/public/sandbox_round.json`. `/?contract=market.hidra-mkt-221016.testnet` switches the page to the live contract views over the public FastNEAR RPC: you see every task the live contract holds (see Testnet rounds for why the live counts exceed the 8-round table).

## Prior work and hackathon scope (Q-003, Q-005)

Existed before 1 Nov 2026 (baseline, not part of this submission):

- The Hidra, our agent orchestrator (a separate repository). It is the source of the data, not a component of the product.
- The Hidra's raw execution ledgers. Only an anonymised export is included here.

Built during the hackathon window, from scratch, in this directory:

- [`RULES.md`](RULES.md): auction, escrow, reputation and spending-cap rules, written before the contract.
- [`contract/`](contract/): Rust contract (near-sdk 5.30): sealed-bid reverse auction with commit-reveal, escrow, attestation, refunds, Beta(α, β) reputation, per-agent spending cap, views. 111 tests (38 unit + 73 near-sandbox).
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
- Testnet only and not audited. Known open limits (Sybil reputation pumping, selective reveal without a bid bond, low-entropy salt grinding, deposit-free registration) are listed with their mitigations in [`SECURITY.md`](SECURITY.md).

## Red team: what we found and fixed

An adversarial agent lane attacked the contract with near-sandbox tests before release. Three real issues came out; each one is fixed, pinned by a test, and the attack was replayed against the upgraded testnet contract. Threat model: [`SECURITY.md`](SECURITY.md).

| Issue | Fix | Test | Testnet evidence |
|---|---|---|---|
| Storage griefing: an oversized task id or result hash made the contract pay the storage stake and could freeze an honest escrow | Bounded strings (task id ≤ 64 B, result hash ≤ 128 B) | [`test_storage_griefing.rs`](contract/tests/test_storage_griefing.rs) | 129-byte hash rejected, round still `Settled`: [`4D9PY6cT…`](https://testnet.nearblocks.io/txns/4D9PY6cTmEGYXHbKGT7vzdVcjLEzuK7TyEszcMKmk6K2) (`swarm/out/testnet_security.json`) |
| Round spam: many minimum-deposit rounds could drain the balance that backs open escrows | `post_task` keeps a storage reserve (`Storage reserve exhausted…`) | [`test_round_spam.rs`](contract/tests/test_round_spam.rs) | Guarded code deployed: [`3jzCb1cV…`](https://testnet.nearblocks.io/txns/3jzCb1cVQ8L1edn5uNKGUUSRjiG4FoX8Ft7ouYm4yAEa) (`swarm/out/testnet_round_spam.json`) |
| Zero price: a bid of 0 scored 0 and won whatever the reputation (Beta(1,1000) beat Beta(1000,1)) | `require!(price > 0)` on reveal | [`test_zero_price_bid.rs`](contract/tests/test_zero_price_bid.rs) | Price-0 reveal rejected, honest bidder wins and is paid: [`DSw8EFwm…`](https://testnet.nearblocks.io/txns/DSw8EFwmCt5QjoDzTpYs2bYLJH1Tn6zgnCELxQ6ihwex) (`swarm/out/testnet_zero_price.json`) |

## Reproduce it in 3 commands

```bash
cd swarm && npm ci && npm run verify:all     # unit tests + every published figure recomputed from data
npm run verify:testnet                       # read-only RPC, no keys, 0 NEAR: re-checks the 8 testnet rounds below
cd .. && make demo                           # contract on local near-sandbox + 60 s market demo
```

The web page also counts a second run of 6 rounds that starts from the on-chain reputation of the first; re-check it the same way with `npm run verify:testnet:f` (`OK 6/6 rounds, 74 txs`).

## Testnet rounds

Run of 8 rounds on [`market.hidra-mkt-221016.testnet`](https://testnet.nearblocks.io/address/market.hidra-mkt-221016.testnet), seed 479, 0.05 NEAR reward each (`swarm/out/testnet_market.json`). A failed attestation refunds the publisher; only verified work is paid. The live page counts every task on the contract (30 at the time of writing, 11 settled): this run, the second run of 6 rounds below, and earlier smoke and storage-griefing proof tasks.

| Round | Bids | Winner at price | State | Attestation tx |
|---|---|---|---|---|
| 1 | 5 | `worker-1` at 216 | `Refunded` | [`52qXc3Kk…`](https://testnet.nearblocks.io/txns/52qXc3Kk1qyAJx29WfgFwK4JdL5buY9d6HRUzuDykUvH) |
| 2 | 4 | `worker-5b` at 312 | `Refunded` | [`yBfi2Uwi…`](https://testnet.nearblocks.io/txns/yBfi2UwiTECn9UqQ1rsrUJUvzYv1NMTHDY3ri64S24P) |
| 3 | 5 | `worker-1` at 228 | `Refunded` | [`BNzNFZMp…`](https://testnet.nearblocks.io/txns/BNzNFZMpgU41TczNMaWC3L1QfY2pQHBBxQvcdHv5Z4pQ) |
| 4 | 4 | `worker-1` at 240 | `Refunded` | [`J3PBA5aV…`](https://testnet.nearblocks.io/txns/J3PBA5aVbTqqGBsETdAw1r9UnBMY4Yky2Kt3oMwhsjgZ) |
| 5 | 4 | `worker-1` at 210 | `Settled` | [`2nRfNFS9…`](https://testnet.nearblocks.io/txns/2nRfNFS9WhiVotRcuaXZfVCvJccv5odjHGjyGH5eGo5w) |
| 6 | 3 | `worker-1` at 176 | `Settled` | [`3wvLGeoF…`](https://testnet.nearblocks.io/txns/3wvLGeoFfrUCb6Bdv25esXX9u79chANoyt245LAtDmQx) |
| 7 | 3 | `worker-4` at 309 | `Refunded` | [`4kDQH5Fx…`](https://testnet.nearblocks.io/txns/4kDQH5Fxum9QvGZsY4p1tZNoUiyzy9roQPHTLMkxb8a8) |
| 8 | 5 | `worker-1` at 152 | `Settled` | [`5PZ5roYp…`](https://testnet.nearblocks.io/txns/5PZ5roYpusmt2zVkkCHAH3SF2dqNH9AbY2Cvu7bXqGY4) |

On-chain reputation right after this run (snapshot in `swarm/out/testnet_market.json`). The workers did not start at Beta(1,1): the contract already held 9 attestations from earlier rounds (`worker-1` entered at Beta(6,2)), so the table is that history plus the 8 rows above. This is also why the winner is the lowest raw bid in only 4 of the 8 rounds: the auction ranks by reputation-adjusted price.

| Worker | Beta(α, β) | Mean |
|---|---|---|
| `worker-1` | (9, 5) | 0.64 |
| `worker-2` | (1, 2) | 0.33 |
| `worker-3` | (1, 2) | 0.33 |
| `worker-4` | (1, 3) | 0.25 |
| `worker-5b` | (1, 2) | 0.33 |

Check any round yourself with no install (public RPC, read-only):

    curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"query","params":{"request_type":"call_function","finality":"final","account_id":"market.hidra-mkt-221016.testnet","method_name":"get_round","args_base64":"'$(printf '{"task_id":"round-5-d-hidra-mkt-221016.testnet"}' | base64 -w0)'"}}' | python3 -c 'import sys,json; print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'

You see `"state":"Settled"`, the four revealed bids and `"winner":"worker-1.hidra-mkt-221016.testnet"`, as in row 5. Reputation keeps moving with later rounds, so `get_reputation` may differ from the snapshot in `swarm/out/testnet_market.json`.

## Sustainability and roadmap

- Maintained as open source (MIT). Every change must keep `make verify` green: contract, swarm and web tests plus the offline demo, with no network and no LLM calls.
- Reproducible gate: `make verify` runs the contract (wasm build + unit and near-sandbox tests), web (typecheck, tests, build, 150 kB code budget) and swarm tests offline, without testnet calls or keys; [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds and deploys the demo.
- The rules live in [`RULES.md`](RULES.md) and are written before the code; any change to the auction, escrow or reputation starts there, then a test, then the contract.
- How to contribute: open an issue describing the rule or behaviour; change `RULES.md` first if the auction, escrow or reputation logic moves; add a failing test in `contract/tests/`, `swarm/test/` or `web/test/`; make it pass; run `make verify` before the pull request. `make verify` must stay green and the web code budget under 150 kB.
- Operating cost, measured on testnet: the 8 rounds in `swarm/out/testnet_market.json` (98 transactions, 3 to 5 bidding workers per round, 33 bids in total) burnt 0.02057 NEAR in total, 0.00257 NEAR and 28.7 Tgas per round on average (post, one commit and one reveal per bidder, close, submit, attest), 5.1 % of the 0.05 NEAR reward; per verified result (3 settled rounds) it is 0.00686 NEAR, 13.7 % of the reward. Source: `swarm/out/testnet_costs.json`, read from the public RPC `tx` method, no keys needed. Today each signer (publisher, workers, verifier) pays its own gas; the operator pays nothing.
- Verifier and RPC cost: the verifier is the account the publisher names in `post_task`; its on-chain cost is one `attest` call per round, 0.000276 NEAR and 3.2 Tgas on average over the 8 testnet `attest` transactions (10.7 % of the round gas; read with the public RPC `tx` method on the `attest` hashes in `swarm/out/testnet_market.json`). Reads use the public FastNEAR RPC (`https://test.rpc.fastnear.com`) at no cost and with no keys. The off-chain check itself is not measured: in the testnet run the attest outcome is a seeded draw (`swarm/scripts/testnet_market_rounds.mjs:4`), so the compute cost of a real check depends on the task and is paid by whoever runs the verifier.
- Revenue model (a proposal, **not implemented**: the contract has no fee and pays the full reward to the winner, `contract/src/lib.rs:409`): a 2 % fee on settled rewards only, deducted from the winning worker's payout and sent to the market operator account, so publishers never pay for refunded work and their escrowed reward is unchanged. Gas per round is flat, so the fee covers the whole measured gas of the market once the reward reaches 0.129 NEAR if every round settles, or 0.343 NEAR at the measured 3/8 settle rate (0.00686 / 0.02). Below that, fee income stays under that measured gas; the 0.05 NEAR testnet rounds are a demo size, not a price.
- Next steps, in order (none is part of this submission): NEAR Intents to settle rewards across chains; a verifier running in a NEAR AI Cloud TEE so attestations do not depend on a trusted account; listing the market in the NEAR Agent Market.

## Repository map

- [`RULES.md`](RULES.md): contract rules.
- [`contract/`](contract/README.md), [`swarm/`](swarm/README.md), [`web/`](web/README.md): one README each.
- [`docs/TESTNET_DEPLOY.md`](docs/TESTNET_DEPLOY.md): the live testnet deployment, its transaction hashes, and how to reproduce it.
- [`docs/VIDEO_SCRIPT.md`](docs/VIDEO_SCRIPT.md), [`docs/X_POST.md`](docs/X_POST.md): demo video script and post draft.
- [`LICENSE`](LICENSE): MIT.
