# Security

Threat model for the sealed reverse-auction market contract (`contract/`, `near-sdk` 5).
Every defense below is linked to a test that proves it. Run the on-chain-logic tests with:

```
cd contract && cargo test --lib --offline
```

(36 tests, all green). The sandbox integration tests live in `contract/tests/`.

## Assumptions

- **Limited FunctionCall keys.** Agents and the verifier operate with NEAR FunctionCall
  access keys restricted to this contract and the methods they need, with a finite gas
  allowance. No full-access keys are used for day-to-day operation.
- **Commit–reveal bidding.** A bid is committed as `sha256(price || salt || account)` and
  revealed in a later window. Prices are hidden until the commit window closes, so a worker
  cannot undercut a price it was not able to see.
- **Per-agent spend cap.** Each worker has a cumulative payout cap (`cap_per_agent_yocto`).
  Settlement that would exceed the remaining cap is refused and the escrow is refunded.
- **Single configured verifier per task.** Only the account the task author designates as
  verifier can attest the result and trigger settlement or refund.

## Threats and defenses

| Threat | Contract defense | Test evidence (`contract/`) |
|---|---|---|
| **Worker keeps the escrow without delivering accepted work** | Only the round winner may submit a result, and only the configured verifier decides settlement. Failed attestations and expired tasks refund the escrow; escrow is conserved across every settlement and refund path. | `submit_result_requires_a_closed_round_won_by_the_caller`, `only_winner_can_submit_result_once`, `verifier_attestation_settles_once_and_updates_reputation`, `failed_attestation_refunds_and_lowers_reputation`, `expired_refund_requires_grace_and_penalizes_missing_result`, `settlements_and_refunds_conserve_the_escrow` — `src/lib.rs` |
| **Fake or altered bid** | Commitments must be SHA-256 hashes; only the committing worker may reveal, and the revealed data must match the commitment and fall inside its window. | `rejects_commitments_that_are_not_sha256_hashes`, `only_committing_worker_can_reveal_a_bid`, `rejects_reveal_that_does_not_match_commitment`, `rejects_commit_and_reveal_outside_their_windows` — `src/lib.rs` |
| **Verifier impersonation** | `attest` checks the caller against the task's configured verifier before changing any state, reputation, or escrow. | `rejects_attestation_from_a_non_verifier_account`, `verifier_attestation_settles_once_and_updates_reputation` — `src/lib.rs` |
| **Spending beyond the per-agent cap** | Settlement is refused and escrow refunded when the remaining cap is insufficient; spend is tracked cumulatively, and the boundary case pays exactly up to the limit. | `cap_exceeded_refunds_instead_of_paying`, `cap_boundary_pays_up_to_limit_and_refunds_when_payment_exceeds_remaining` — `src/lib.rs` |
| **Storage griefing / frozen escrow** | Every caller-supplied string stored in state is length-bounded, so an attacker running a 1-yocto task of its own cannot bloat contract storage with a huge `result_hash` (≤128 B) or task `id` (≤64 B) and push the contract's free balance below its storage stake, which would otherwise freeze honest escrows (`LackBalanceForState` on `attest`/`refund_expired`). | `test_storage_griefing_freezes_honest_escrow` — `tests/test_storage_griefing.rs` |
| **Round-spam storage griefing / frozen escrow** | `post_task` enforces a storage-reserve invariant: the contract's own funds (balance minus the escrows it still owes) must cover its staked storage plus a fixed reserve. A burst of many distinct 1-yocto tasks grows staked storage faster than its escrows, so each spam task is rejected (`Storage reserve exhausted`) before the free balance can drop below the storage stake and freeze an honest payout with `LackBalanceForState`. No state-layout change (upgradeable without migration). | `distinct_minimum_deposit_rounds_cannot_freeze_honest_payout` — `tests/test_round_spam.rs` |
| **Collusive verifier / Sybil reputation pump** | Reputation is Beta(α,β) evidence, not an identity claim: one operator controlling publisher, worker, and verifier can run self-dealing rounds to raise its own α at only gas cost, and a pumped Sybil can win over a cheaper honest worker because the price is divided by the mean Beta score. This is a disclosed design limit, not a contract bug — the on-chain rules (fixed verifier per task, escrow conservation, per-agent cap) still hold; defending against identity farming requires off-chain Sybil resistance (staking, KYC, or a trusted verifier set). The tests pin the exact cost and effect so the limit cannot silently widen. | `collusive_verifier_pumps_reputation_at_near_zero_cost`, `pumped_sybil_outbids_a_cheaper_honest_worker`, `control_without_pump_the_cheaper_honest_worker_wins` — `tests/test_collusive_verifier_reputation.rs` |
| **Stolen function-call key** | Restrict the key to this contract and the required methods, set a finite gas allowance, and revoke it promptly if compromised. **Documented gap:** if the stolen key is authorized for `attest`, it can still release escrow after a winner submits a result — the contract cannot distinguish it from the legitimate verifier. This is an operational risk, not a contract defense: no test can prove key scope, allowance, or revocation, which are enforced off-chain. What is pinned is that the contract never *widens* that scope itself — it manages no access keys, exposes no owner/migration backdoor, and the task verifier is fixed at `post_task` and never reassigned, so a stolen worker key cannot escalate. | `contract_never_manages_access_keys`, `contract_has_no_owner_or_migration_backdoor`, `task_verifier_is_immutable_after_post_task`, `escrow_only_leaves_via_transfer` — `tests/test_key_scope.rs` |
| **Broken upgrade / state loss on redeploy** | The live testnet account is upgraded by redeploying the same-layout wasm with no init call (the `LISTO-DEPLOY` path). A bad upgrade could reset the singleton, drop collections, or require a migration that corrupts in-flight escrows. The contract keeps a fixed state layout (same structs and storage keys), so redeploying the same wasm without an init call preserves every task, registered worker, open bid, and Beta reputation, and an in-flight round still settles on the upgraded code — no migration, no state reset. | `redeploy_same_layout_preserves_state_without_migration` — `tests/test_state_upgrade.rs` |
| **Gas-exhaustion DoS** | A function whose gas cost grows with state (unbounded loops over tasks/bids) could become uncallable once the market fills, freezing settlements. Every public method runs in constant gas regardless of how many tasks or workers exist; measured over a full lifecycle each call burns ≤ 3.3 Tgas (max `attest` 3.30, `refund_expired` 2.76, all others ~2.1–2.3), far under the 15 Tgas budget and the 30 Tgas default allowance, so no honest caller ever needs to raise gas. | `test_gas_per_function_within_budget` — `tests/test_gas_budget.rs` |
| **Open-task griefing / escrow freeze** | An attacker opens many cheap tasks at once to grow staked storage and starve an honest escrow of free balance. Because `post_task` charges the storage-reserve invariant per task, a 100-task spam burst is each priced in real funds and never pushes the contract below its storage stake, so an honest escrow still settles (`LackBalanceForState` cannot be triggered). | `minimum_deposit_open_task_spam_cannot_freeze_honest_escrow` — `tests/test_open_task_griefing.rs` |
| **Reputation laundering via re-registration** | A high Beta `β` from failed attests makes a worker look dear to the reverse auction (price is divided by mean Beta), so the cheapest single-account escape would be to call `register_worker` again and reset the history to the Beta(1,1) prior. `register_worker` rejects any already-registered account (`Worker already registered`) and never writes the `reputations` map, so accrued `β` cannot be wiped: a worker only clears a bad record by abandoning the account for a fresh one, i.e. the Sybil path already disclosed above. | `reregistration_is_rejected`, `bad_reputation_survives_reregistration_attempt` — `tests/test_reputation_laundering.rs` |

## Reporting a vulnerability

Report security issues privately to the maintainer rather than opening a public issue.
Include the affected method, a reproduction (a failing test or a transaction trace is
ideal), and the impact. Do not disclose publicly until a fix is available.

Keep this file synchronized with the source: if a cited test is renamed or moved, update
the reference here so every link stays verifiable.
