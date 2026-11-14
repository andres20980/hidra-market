# contract: Hidra Market on NEAR

Rust contract (near-sdk 5.30, scaffolded with `cargo near new`). Rules: [`../RULES.md`](../RULES.md).

- Build: `cargo near build non-reproducible-wasm` → `target/near/contract.wasm` (about 175 KB).
- Test: `cargo test` → 111 tests (38 unit + 73 near-sandbox integration across 42 files in `tests/`): unit tests for every rule in `src/lib.rs`, rule and tie-break tests, plus near-sandbox integration and adversarial red-team tests (full round with three workers, expired-task refund, storage/round/open-task griefing, collusive verifier and Sybil reputation, gas budget, close_round gas at the 512-bid cap, state upgrade on redeploy, submit_result guards, zero-price bid rejected in `reveal_bid` so a 0 bid cannot override reputation, wrapping or unreachable commit/reveal windows, silent verifier after delivery, selective-reveal ladder of Sybil commitments).
- Coverage: every rule in [`../RULES.md`](../RULES.md) has an explicit test (33 rule rows), including the 3 limit cases added on 12-nov (commitment of exactly 32 bytes, one reveal per commitment, zero-length windows) and the 3 permission/invariant tests added at 19:58 (`close_round` callable by any account, `submit_result` only by the winner of a closed round, escrow conservation across settlements and refunds). The view gas cap added at 20:45 (`list_tasks` returns at most 100 tasks per call) has its own test (`list_tasks_caps_the_limit_to_100`), so the 34 clauses of `RULES.md` are covered.
- From the parent directory, `make verify` runs both.

## Offline build (no near-cli, works with a read-only `$HOME`)

`./build-wasm.sh` builds the wasm and needs no `cargo-near`, no network and no writable `$HOME`;
it redirects XDG dirs to a temp scratch so `near-cli`/`cargo-near` never write to `$HOME/.config`.
It uses `cargo near build non-reproducible-wasm` when available and otherwise falls back to a plain raw
wasm build (`cargo build --locked --offline --target wasm32-unknown-unknown --release`), which is not
post-processed by `wasm-opt` and is therefore larger; set `CARGO_NEAR_BIN=none` to force the fallback.
Measured on 12-nov 21:23: fallback `target/wasm32-unknown-unknown/release/contract.wasm` **345937 bytes**,
sha256 `9242923a486e4478`; the near-cli artefact stays at `target/near/contract.wasm` **178726 bytes**,
sha256 `566c0618442744fa`.

Methods: `init(cap_per_agent)`, `post_task` (payable: the deposit is the escrowed reward), `register_worker`, `commit_bid`, `reveal_bid`, `close_round`, `submit_result`, `attest` (task verifier only), `refund_expired`. Views: `get_task`, `list_tasks` (at most 100 tasks and 8,192 commitments+bids per call), `get_round`, `get_reputation`, `get_config`.

## Reproducing the cold-cache check (clean copy, no network, read-only `$HOME`)

Copy `producto/` to a fresh directory (no `contract/target`, no registry cache) and run:

```bash
time PATH="$HOME/.cargo/bin:$PATH" timeout 600 make verify
```

- `make verify` (build + tests + simulation demo): exit 0, **33.92 s** (23.02 user + 4.47 system).
- `target/near/contract.wasm` (cold-cache measurement, 12-nov 16:28): **178745 bytes**, sha256 `ab4cd46eb5007b433535660687ff29c6e3f4f0f796fd2822ecdff725d6c1c179`.
- `target/near/contract.wasm` (current build, 12-nov 20:47): **178726 bytes**, sha256 `566c0618442744fac7fe57d25157a642243dfec64d15f86e22f0fc13323277f2`; two consecutive builds are byte-identical.
- Tests: **111** (38 unit in `src/lib.rs` + 73 near-sandbox integration across 42 files in `tests/`), offline; red-team suite added 13-nov (last full green run 111/111 on 14-nov 07:00, `cargo test --offline`).
- Local re-run with a warm cache: 27.4 s (24 + 2 + 1 + 5) before the 3 limit tests; 26.8 s (27 + 2 + 1 + 5) after them; 32 + 2 + 1 + 5 after the view-gas-cap test (12-nov 20:45).
- Rebuild determinism: `./check-reproducible.sh` forces two consecutive rebuilds and requires byte-identical output (shown on 12-nov 21:43).
  Current artefacts (build 14-nov 02:02 of the current `src/lib.rs`): `target/wasm32-unknown-unknown/release/contract.wasm`
  **222912 bytes**, sha256 `df52a31b3ba162b44d3926109d2609249ecc89966a1af7cad396266beb84d949` — the raw file `make verify` deploys
  (`Makefile:16`); `target/near/contract.wasm` is the near-cli copy (wasm-opt'ed, 181028 bytes, sha256 `0563f913313df7ff...`).
- Reproducibility check anyone can re-run: `./check-reproducible.sh` (offline, no network, no writable `$HOME`):
  two rebuilds, prints sizes and hashes, exits 0 only if both builds are byte-identical
  (12-nov 21:44 measurement: exit 0, `REPRODUCIBLE`).

Source of the clean-copy measurement: `hidra/agentes/juez/ESTADO.md` (12-nov 16:28 / 16:45, screening Q-017).
