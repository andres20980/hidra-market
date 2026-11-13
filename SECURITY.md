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
| **Stolen function-call key** | Restrict the key to this contract and the required methods, set a finite gas allowance, and revoke it promptly if compromised. **Documented gap:** if the stolen key is authorized for `attest`, it can still release escrow after a winner submits a result — the contract cannot distinguish it from the legitimate verifier. This is an operational risk, not a contract defense: no test can prove key scope, allowance, or revocation, which are enforced off-chain. What is pinned is that the contract never *widens* that scope itself — it manages no access keys, exposes no owner/migration backdoor, and the task verifier is fixed at `post_task` and never reassigned, so a stolen worker key cannot escalate. | `contract_never_manages_access_keys`, `contract_has_no_owner_or_migration_backdoor`, `task_verifier_is_immutable_after_post_task`, `escrow_only_leaves_via_transfer` — `tests/test_key_scope.rs` |

## Reporting a vulnerability

Report security issues privately to the maintainer rather than opening a public issue.
Include the affected method, a reproduction (a failing test or a transaction trace is
ideal), and the impact. Do not disclose publicly until a fix is available.

Keep this file synchronized with the source: if a cited test is renamed or moved, update
the reference here so every link stays verifiable.
