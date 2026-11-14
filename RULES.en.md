# RULES.en.md v1.4 · Hidra Market — contract rules (English translation of [`RULES.md`](RULES.md), same line numbers)

Specification of the implementation in `contract/`. Deadlines are expressed in NEAR block heights.

## 1. Roles and task creation

- The publisher calls `post_task(id, verifier, commit_len, reveal_len)` with an attached deposit greater than zero; the full deposit is the reward held in escrow.
- The task identifier must be unique. The contract sets `commit_end = current_height + commit_len` and `reveal_end = commit_end + reveal_len`; calculations that overflow are rejected.
- The publisher names the verifier for that task. No deposit is required to register, commit or reveal bids.
- A worker calls `register_worker`; its initial reputation is Beta(1,1), that is, `alpha=1`, `beta=1`.

## 2. Commit and reveal

- Only registered workers can call `commit_bid`. One commitment per worker and task is accepted, of exactly 32 bytes (SHA-256), while `height < commit_end`.
- The bid price is a `u64` in milliNEAR (80 = 0.08 NEAR): it is the worker's offer; the payment released is always the reward held in escrow.
- The commitment is computed as `SHA-256(price_u64_be || salt_u32_be || account_utf8)`: `u64` price and `u32` salt in big-endian, followed by the UTF-8 bytes of the account identifier, with no separators.
- `reveal_bid(price, salt)` is only accepted in `[commit_end, reveal_end)`. It must come from the account that committed and the recomputed hash must match; otherwise it is rejected. Each valid commitment is revealed only once. The revealed price must be greater than zero (`Price must be > 0`): a bid of 0 would have an adjusted price of 0 at any reputation and would defeat the Beta weighting (`contract/tests/test_zero_price_bid.rs`).
- A zero duration is valid: `commit_len=0` prevents committing and `reveal_len=0` prevents revealing.

## 3. Closing and winner selection

- Any account can call `close_round` from `reveal_end`, inclusive. Unrevealed commitments are ignored.
- For a Beta(`alpha`, `beta`) reputation, the mean is `alpha/(alpha+beta)` and the adjusted price is `price / mean`. If `alpha=0`, the bid is not eligible. An uninitialised reputation uses the prior (1,1).
- Adjusted prices are compared as the exact fraction `price*(alpha+beta)/alpha`, with no rounding.
- The lowest adjusted price wins. On an exact tie, the tie-breakers are, in this order: lower nominal price; higher `alpha+beta`; higher `alpha`; and the lexicographically smaller account.
- If there are no eligible revealed bids, the round closes without a winner.

## 4. Result, attestation, payment and refund

- Only the winner of a closed round can call `submit_result` and record a result hash; only one delivery is accepted.
- Only the verifier named in `post_task` can call `attest`, and only after the result has been submitted. The first attestation ends the task.
- With `attest(ok=true)`, the full reward is paid to the winner, it is added to the winner's cumulative spend and `alpha` increases by one. Spend only counts rewards actually paid and accumulates across tasks.
- The per-agent spending cap (`cap_per_agent`) is set when the contract is initialised. If the payment exceeds the remaining cap, the task is marked refunded and the deposit is returned to the publisher; nothing is paid and neither spend nor reputation changes.
- With `attest(ok=false)`, the reward is returned to the publisher and the winner's `beta` increases by one.
- From `reveal_end + 100` blocks, inclusive, any account can call `refund_expired` if the task is still closed. It returns the deposit to the publisher. If no result was submitted and there was a winner, one is added to its `beta`; if a result was submitted, there is no penalty. A round closed without a winner can also be refunded.

## 5. Views

`get_task(id)`, `list_tasks(from, limit)`, `get_round(task_id)` and `get_reputation(account)` expose tasks, rounds and reputation; `get_reputation` returns `alpha`, `beta` and the mean as JSON strings. `list_tasks` returns at most 100 tasks per call (view gas cap) and cuts the page once it exceeds 8,192 accumulated commitments+bids (always at least one task; the client paginates with `from += len`), so as not to exceed NEAR's 4 MiB response limit.

## 6. One round as a text sequence

1. Publisher → `post_task` with deposit, verifier and windows.
2. Workers → `register_worker` and `commit_bid(SHA-256(price||salt||account))` before `commit_end`.
3. Workers → `reveal_bid(price, salt)` from `commit_end` and before `reveal_end`.
4. Any account → `close_round` from `reveal_end`; the contract selects the winner.
5. Winner → `submit_result(hash)`; verifier → `attest(ok)`.
6. If `ok=true` and the cap allows it, the winner is paid and `alpha` increases; if `ok=false`, the publisher is refunded and `beta` increases. If the deadline passes without an attestation, any account can trigger the refund.

## 7. Artifact reproducibility (updated 14 Nov 04:00)

- Toolchain pinned in `contract/rust-toolchain.toml` (Rust 1.95.0 + `wasm32-unknown-unknown` target) and dependencies locked in `Cargo.lock`; builds run with `--offline`.
- Deterministic build: `contract/check-reproducible.sh` forces 2 consecutive rebuilds and requires identical bytes (demonstrated on 13 Nov). Artifacts of the current `src/lib.rs` (sha256 `5ac18db0…`, built 14 Nov 05:38): raw wasm `target/wasm32-unknown-unknown/release/contract.wasm` = 222953 B, sha256 `60d6ea078f6648384a115b9e585811c980793bb1aa309c250173e475bf9c55d2`; near-cli copy `target/near/contract.wasm` = 181063 B, sha256 `f054dc77aece86d87339adadc77201044f159ee031b6661f604dacee49cfce48` (= code_hash live on testnet `HB9u9hrh…`).
- Tests: `cargo test -q --offline` → 111 (38 unit tests in `src/lib.rs` + 73 near-sandbox integration tests across 42 files in `tests/`).
- Module verifier: `cd producto/contract && cargo near build non-reproducible-wasm && cargo test -q`.

## 8. Bid limit and closing gas

- Cap of 512 commitments per task (`MAX_BIDS_PER_TASK`; the 513th is rejected with `Task bid limit reached`). The gas of `close_round` grows by ~96 Ggas per bid (measured in sandbox: 2.5 Tgas with 4 bids, ~51 Tgas at the cap): whoever closes a full round must attach ≥ 60 Tgas. If it runs out of gas, the whole call reverts and the task can still be closed with more gas (`contract/tests/test_close_round_gas_sandbox.rs`).
