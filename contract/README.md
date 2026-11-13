# contract: Hidra Market on NEAR

Rust contract (near-sdk 5.30, scaffolded with `cargo near new`). Rules: [`../RULES.md`](../RULES.md).

- Build: `cargo near build non-reproducible-wasm` → `target/near/contract.wasm` (about 175 KB).
- Test: `cargo test` → 40 tests (32 unit + 8 near-sandbox integration): unit tests for every rule in `src/lib.rs`, rule and tie-break tests in `tests/`, and near-sandbox integration tests (a full round with three workers, expired-task refund).
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

Methods: `init(cap_per_agent)`, `post_task` (payable: the deposit is the escrowed reward), `register_worker`, `commit_bid`, `reveal_bid`, `close_round`, `submit_result`, `attest` (task verifier only), `refund_expired`. Views: `get_task`, `list_tasks` (at most 100 tasks per call), `get_round`, `get_reputation`, `get_config`.

## Reproducing the cold-cache check (clean copy, no network, read-only `$HOME`)

Copy `producto/` to a fresh directory (no `contract/target`, no registry cache) and run:

```bash
time PATH="$HOME/.cargo/bin:$PATH" timeout 600 make verify
```

- `make verify` (build + tests + simulation demo): exit 0, **33.92 s** (23.02 user + 4.47 system).
- `target/near/contract.wasm` (cold-cache measurement, 12-nov 16:28): **178745 bytes**, sha256 `ab4cd46eb5007b433535660687ff29c6e3f4f0f796fd2822ecdff725d6c1c179`.
- `target/near/contract.wasm` (current build, 12-nov 20:47): **178726 bytes**, sha256 `566c0618442744fac7fe57d25157a642243dfec64d15f86e22f0fc13323277f2`; two consecutive builds are byte-identical.
- Tests: **40 green** (32 unit in `src/lib.rs` + 8 near-sandbox integration in `tests/`), offline: 0,35 s unit + 10,91 s + 15,03 s + 0,16 s integration (12-nov 20:45).
- Local re-run with a warm cache: 27.4 s (24 + 2 + 1 + 5) before the 3 limit tests; 26.8 s (27 + 2 + 1 + 5) after them; 32 + 2 + 1 + 5 after the view-gas-cap test (12-nov 20:45).
- Rebuild determinism (12-nov 21:43, forced relink after `touch src/lib.rs`):
  `cargo near build non-reproducible-wasm` -> `target/wasm32-unknown-unknown/release/contract.wasm`
  **220193 bytes**, sha256 `5a340a461658f06b19fedbd3fbdfaa2f91ee1ef4fc8459bd5c2eb44650cc64d7`; two consecutive
  rebuilds are byte-identical. That raw file is the artefact `make verify` deploys (`Makefile:16`:
  `$(CONTRACT)/target/wasm32-unknown-unknown/release/contract.wasm`), while `target/near/contract.wasm` is the
  near-cli copy (wasm-opt'ed, 178726 bytes, sha256 `566c0618442744fa...`): two different files, both reproducible.
- Reproducibility check anyone can re-run: `./check-reproducible.sh` (offline, no network, no writable `$HOME`):
  two rebuilds, prints sizes and hashes, exits 0 only if both builds are byte-identical
  (12-nov 21:44 measurement: exit 0, `REPRODUCIBLE`).

Source of the clean-copy measurement: `hidra/agentes/juez/ESTADO.md` (12-nov 16:28 / 16:45, screening Q-017).
