// test_settlement_exclusivity.rs v1.0
// RED TEAM: a task's escrow has two exits, `attest` (verifier) and
// `refund_expired` (anyone, after the grace window). If both could fire for the
// same task, the escrow would be paid twice (worker AND publisher) out of the
// contract's own balance. These green tests pin that the exits are mutually
// exclusive and single-shot:
//   1) attest(true) settles -> refund_expired, a second attest(true) and
//      attest(false) are all rejected; spend counter and alpha move exactly once;
//   2) verifier silent past grace -> refund_expired refunds the publisher ->
//      a late attest(true) is rejected, the worker is not paid, alpha unchanged
//      (and no beta penalty: the worker did submit);
//   3) a second refund_expired is rejected.
use contract::{Contract, Reputation, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

const WORKER: &str = "worker.testnet";
const VERIFIER: &str = "verifier.testnet";
const PUBLISHER: &str = "publisher.testnet";
const REWARD: u128 = 1_000_000;
const GRACE: u64 = 100;

fn set_context(predecessor: &str, block_height: u64, deposit: u128) {
    testing_env!(
        VMContextBuilder::new()
            .predecessor_account_id(predecessor.parse().unwrap())
            .block_height(block_height)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(100))
            .build()
    );
}

fn commitment(worker: &AccountId, price: u64, salt: u32) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&price.to_be_bytes());
    p.extend_from_slice(&salt.to_be_bytes());
    p.extend_from_slice(worker.as_str().as_bytes());
    near_sdk::env::sha256(&p)
}

fn rep(c: &Contract) -> Reputation {
    c.reputations
        .get(&WORKER.parse::<AccountId>().unwrap())
        .cloned()
        .unwrap_or(Reputation { alpha: 1, beta: 1 })
}

fn spent(c: &Contract) -> u128 {
    c.spent_by_agent
        .get(&WORKER.parse::<AccountId>().unwrap())
        .copied()
        .unwrap_or(0)
}

fn rejected(c: &mut Contract, who: &str, height: u64, f: impl FnOnce(&mut Contract)) -> String {
    set_context(who, height, 0);
    let r = catch_unwind(AssertUnwindSafe(|| f(c)));
    let err = r.expect_err("call must be rejected");
    err.downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default()
}

/// Posts, bids, reveals, closes and submits. Returns (contract, reveal_end).
fn submitted_round() -> (Contract, u64) {
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(NearToken::from_near(1).as_yoctonear());
    set_context(WORKER, 2, 0);
    c.register_worker();
    set_context(PUBLISHER, 3, REWARD);
    c.post_task("t".into(), VERIFIER.parse().unwrap(), 10, 10);
    let w: AccountId = WORKER.parse().unwrap();
    set_context(WORKER, 4, 0);
    c.commit_bid("t".into(), commitment(&w, 7, 42));
    set_context(WORKER, 14, 0);
    c.reveal_bid("t".into(), 7, 42);
    set_context(PUBLISHER, 24, 0);
    c.close_round("t".into());
    set_context(WORKER, 25, 0);
    c.submit_result("t".into(), "a".repeat(64));
    let reveal_end = c.get_task("t".into()).unwrap().reveal_end;
    (c, reveal_end)
}

#[test]
fn settled_task_cannot_be_refunded_or_paid_twice() {
    let (mut c, reveal_end) = submitted_round();
    set_context(VERIFIER, 26, 0);
    c.attest("t".into(), true);
    assert_eq!(c.get_task("t".into()).unwrap().state, TaskState::Settled);
    assert_eq!(spent(&c), REWARD);
    assert_eq!(rep(&c).alpha, 2);

    let late = reveal_end + GRACE;
    let e = rejected(&mut c, PUBLISHER, late, |c| c.refund_expired("t".into()));
    assert!(e.contains("Task is not closed"), "{e}");
    let e = rejected(&mut c, VERIFIER, late, |c| c.attest("t".into(), true));
    assert!(e.contains("Task is not closed"), "{e}");
    let e = rejected(&mut c, VERIFIER, late, |c| c.attest("t".into(), false));
    assert!(e.contains("Task is not closed"), "{e}");

    assert_eq!(spent(&c), REWARD, "spend counted once");
    assert_eq!((rep(&c).alpha, rep(&c).beta), (2, 1), "no reputation drift");
}

#[test]
fn refunded_task_cannot_be_attested_or_refunded_again() {
    let (mut c, reveal_end) = submitted_round();
    let late = reveal_end + GRACE;
    set_context(PUBLISHER, late, 0);
    c.refund_expired("t".into());
    assert_eq!(c.get_task("t".into()).unwrap().state, TaskState::Refunded);
    assert_eq!((rep(&c).alpha, rep(&c).beta), (1, 1), "submitter not penalised");

    let e = rejected(&mut c, VERIFIER, late + 1, |c| c.attest("t".into(), true));
    assert!(e.contains("Task is not closed"), "{e}");
    let e = rejected(&mut c, PUBLISHER, late + 1, |c| c.refund_expired("t".into()));
    assert!(e.contains("Task is not closed"), "{e}");

    assert_eq!(spent(&c), 0, "worker never paid after refund");
    assert_eq!((rep(&c).alpha, rep(&c).beta), (1, 1));
}
