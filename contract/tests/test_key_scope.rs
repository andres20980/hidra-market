// test_key_scope.rs v1.1
// Documentation guard for SECURITY.md row 5 ("Stolen function-call key").
//
// The contract cannot inspect the scope of the NEAR access key that signs a
// call (FunctionCall vs FullAccess is enforced off-chain when the key is
// created). What the contract CAN guarantee, and what this test pins, is that
// it never widens that scope itself and never lets a stolen key escalate:
//   - the contract never adds or deletes access keys (no Promise key API),
//   - there is no owner/admin/migrate backdoor method,
//   - a task's verifier is fixed at post_task and can never be reassigned,
//   - escrow only ever leaves the contract via `Promise::transfer`.
// These are the contract-level halves of the key-hygiene assumption; the
// off-chain halves (restricting the key, allowance, revocation) stay operational.
//
// Pure source assertions: offline, deterministic, no sandbox or network.

const SRC: &str = include_str!("../src/lib.rs");

/// Count non-comment occurrences of a needle (strips `//` line comments so the
/// explanatory text in lib.rs cannot trip the guard).
fn hits(needle: &str) -> usize {
    SRC.lines()
        .map(|l| l.split("//").next().unwrap_or(""))
        .filter(|code| code.contains(needle))
        .count()
}

#[test]
fn contract_never_manages_access_keys() {
    for api in [
        "add_access_key",
        "add_full_access_key",
        "delete_key",
        "promise_batch_action_add_key",
        "AddKey",
    ] {
        assert_eq!(hits(api), 0, "contract must not touch access keys: {api}");
    }
}

#[test]
fn contract_has_no_owner_or_migration_backdoor() {
    for backdoor in ["set_verifier", "fn migrate", "owner", "admin"] {
        assert_eq!(
            hits(backdoor),
            0,
            "contract must expose no privileged backdoor: {backdoor}"
        );
    }
}

#[test]
fn task_verifier_is_immutable_after_post_task() {
    // The verifier field is only ever bound once, inside post_task's Task
    // construction (`verifier,` shorthand). No reassignment `task.verifier =`
    // exists anywhere, so a stolen worker key can never redirect attestation.
    // An assignment is `task.verifier =` NOT followed by a second `=` (which
    // would be the `==` equality check in attest). Subtract the comparisons.
    assert_eq!(
        hits("task.verifier =") - hits("task.verifier =="),
        0,
        "the configured verifier must never be reassigned"
    );
    assert!(
        SRC.contains("task.verifier == verifier"),
        "attest must check the caller against the configured verifier"
    );
}

/// Slice the body of a `pub fn <name>(` up to the matching closing brace at the
/// same indentation (methods are indented 4 spaces, so their body closes with a
/// 4-space `}`). Returns "" if the method is absent.
fn fn_body(name: &str) -> String {
    let head = format!("pub fn {name}(");
    let start = match SRC.find(&head) {
        Some(i) => i,
        None => return String::new(),
    };
    let rest = &SRC[start..];
    match rest.find("\n    }") {
        Some(end) => rest[..end].to_string(),
        None => rest.to_string(),
    }
}

#[test]
fn attest_entrypoint_gates_on_configured_verifier() {
    // Structural guard, not a scattered-text guard: the verifier check is pinned
    // *inside* the attest body. A silent weakening (dropping the predecessor
    // binding or the `== verifier` require) fails here; a rename of `attest`
    // empties the body and also fails, forcing a conscious re-affirmation of the
    // gate instead of a silent pass. This is the half SECURITY.md row 5 leans on.
    let body = fn_body("attest");
    assert!(
        !body.is_empty(),
        "attest entrypoint must exist (SECURITY.md row 5 names it by this name)"
    );
    assert!(
        body.contains("env::predecessor_account_id()"),
        "the attesting account must come from the caller, not an argument"
    );
    assert!(
        body.contains("task.verifier == verifier"),
        "attest must gate on the configured verifier before releasing escrow"
    );
}

#[test]
fn escrow_only_leaves_via_transfer() {
    // Any value movement is an explicit Promise transfer; there is no raw
    // account-batch funding path a leaked key could abuse.
    assert_eq!(hits("function_call"), 0, "no cross-contract call surface");
    assert!(
        hits("Promise::new") > 0 && hits(".transfer(") > 0,
        "escrow payouts/refunds must use Promise transfer"
    );
}
