# contract: Hidra Market on NEAR

Rust contract (near-sdk 5.30, scaffolded with `cargo near new`). Rules: [`../RULES.md`](../RULES.md).

- Build: `cargo near build non-reproducible-wasm` → `target/near/contract.wasm` (about 175 KB).
- Test: `cargo test` → 32 tests: unit tests for every rule in `src/lib.rs`, rule and tie-break tests in `tests/`, and near-sandbox integration tests (a full round with three workers, expired-task refund).
- From the parent directory, `make verify` runs both.

Methods: `init(cap_per_agent)`, `post_task` (payable: the deposit is the escrowed reward), `register_worker`, `commit_bid`, `reveal_bid`, `close_round`, `submit_result`, `attest` (task verifier only), `refund_expired`. Views: `get_task`, `list_tasks`, `get_round`, `get_reputation`, `get_config`.
