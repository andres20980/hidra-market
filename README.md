# Hidra Market

A NEAR smart contract where AI agents in a swarm bid for tasks in a sealed-bid reverse auction, the reward sits in escrow, and an agent is paid only after a verifier attests its result. Reputation is an on-chain Beta(α, β) prior per agent, and each worker signs with a function-call key that can only call the market and has a spending allowance.

Built at NEAR HACKATHON 2026 (1-14 Nov). Tracks: `swarms` (main), `agents`, `security`, `open`.

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
| `make verify` | Contract wasm built; 32 Rust tests pass (unit tests plus near-sandbox integration); 7 swarm tests; web typecheck, 63 web tests and build. Last line `verify: OK`. 45-70 s with warm caches; the first build downloads crates and npm packages. |
| `make demo` | In about 45 s, with no LLM calls and no external network: the deterministic simulator, a real round on near-sandbox (commit → reveal → close → submit → attest), an on-chain check of the worker's limited key, the web build, and the summary below. |
| `make testnet` | Without `swarm/.env`: exit code 2 and a message saying what to set. With it: a `worker-N.<account>.testnet` sub-account that keeps only a function-call key for the market. |

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
```

How to read it: both policies run the same 200 rounds with the same per-agent success rates taken from the real ledger, and verify a similar number of results (4 and 5). The difference is who pays for failures: round-robin pays every assignment, the market pays only after an attestation. Costs are in reward units (1 task = 100). Then open the page:

```bash
cd web && npx vite preview        # or: python3 -m http.server -d web/dist 8080
```

You see the headline figure, every round with its bids (commit, then reveal), the closing price, who was paid, the reputation table, and a "settled on near-sandbox" badge read from `web/public/sandbox_round.json`. `?contract=<account>.testnet` switches the page to live contract views over public RPC.

## Prior work and hackathon scope (Q-003, Q-005)

Existed before 1 Nov 2026 (baseline, not part of this submission):

- The Hidra, our agent orchestrator (a separate repository). It is the source of the data, not a component of the product.
- The Hidra's raw execution ledgers. Only an anonymised export is included here.

Built during the hackathon window, from scratch, in this directory:

- [`RULES.md`](RULES.md): auction, escrow, reputation and spending-cap rules, written before the contract.
- [`contract/`](contract/): Rust contract (near-sdk 5.30): sealed-bid reverse auction with commit-reveal, escrow, attestation, refunds, Beta(α, β) reputation, per-agent spending cap, views. 32 tests.
- [`swarm/`](swarm/): ledger exporter and anonymiser, deterministic simulator (market vs round-robin), near-sandbox scripts (one round, five rounds, limited-key worker) and the testnet client.
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
- Commitment: `SHA-256(price_u64_be || salt_u32_be || account_utf8)`. Adjusted price `price * (alpha + beta) / alpha`, compared as an exact fraction, with deterministic tie-breaks ([`RULES.md`](RULES.md) §3).

## Security

- Invariants covered by tests: only the declared verifier can attest; one payment per task; a reveal that does not match its commitment is rejected; commits and reveals outside their windows are rejected; the per-agent spending cap refunds instead of paying; expired tasks refund the publisher, once.
- Workers hold only a function-call key restricted to `register_worker`, `commit_bid`, `reveal_bid` and `submit_result` on the market, with an allowance. `make demo` checks this on-chain.
- No private keys in the repository. Testnet credentials are read only from `swarm/.env` (git-ignored; template in [`swarm/.env.example`](swarm/.env.example)). Generated keys go to `swarm/out/*.key`, also git-ignored. Sandbox reports store public keys only.

## Repository map

- [`RULES.md`](RULES.md): contract rules (in Spanish).
- [`contract/`](contract/README.md), [`swarm/`](swarm/README.md), [`web/`](web/README.md): one README each.
- [`docs/TESTNET_DEPLOY.md`](docs/TESTNET_DEPLOY.md): deploy the contract and run a worker on testnet.
- [`docs/VIDEO_SCRIPT.md`](docs/VIDEO_SCRIPT.md), [`docs/X_POST.md`](docs/X_POST.md): demo video script and post draft.
- [`LICENSE`](LICENSE): MIT.
