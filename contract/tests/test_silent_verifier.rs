// test_silent_verifier.rs v1.0
// RED TEAM: the verifier is the trust root of each task. If it stays silent
// after the winner delivered, nothing forces an attest: once the refund grace
// (reveal_end + 100 blocks) elapses, anyone may call refund_expired and the
// publisher gets the escrow back. When publisher == verifier (allowed), that is
// "work for free". Pinned as a disclosed design limit, with its bounds:
// - the delivering winner is NOT penalised (beta unchanged) nor paid;
// - a late attest still settles while nobody has refunded (no deadline);
// - refund and attest are mutually exclusive: the first one wins.
use contract::{Contract, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

const REWARD: u128 = 1_000_000;

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

fn commitment(worker: &str, price: u64, salt: u32) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&price.to_be_bytes());
    p.extend_from_slice(&salt.to_be_bytes());
    p.extend_from_slice(worker.as_bytes());
    near_sdk::env::sha256(&p)
}

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

/// One round where `publisher` names itself verifier and `worker` wins and
/// delivers. Windows: commit [3,13), reveal [13,23), refund from 123.
fn delivered_round(tag: &str) -> (Contract, String, String, String) {
    let publisher = format!("pub{tag}.testnet");
    let worker = format!("w{tag}.testnet");
    let task = format!("t{tag}");
    set_context(&publisher, 1, 0);
    let mut c = Contract::init(NearToken::from_near(1).as_yoctonear());
    set_context(&worker, 2, 0);
    c.register_worker();
    set_context(&publisher, 3, REWARD);
    c.post_task(task.clone(), acc(&publisher), 10, 10);
    set_context(&worker, 4, 0);
    c.commit_bid(task.clone(), commitment(&worker, 5, 77));
    set_context(&worker, 13, 0);
    c.reveal_bid(task.clone(), 5, 77);
    set_context(&publisher, 23, 0);
    c.close_round(task.clone());
    set_context(&worker, 24, 0);
    c.submit_result(task.clone(), "a".repeat(64));
    let t = c.get_task(task.clone()).unwrap();
    assert_eq!(t.winner, Some(acc(&worker)));
    assert!(t.result_hash.is_some());
    (c, publisher, worker, task)
}

#[test]
fn silent_self_verifier_reclaims_escrow_after_delivery() {
    let (mut c, publisher, worker, task) = delivered_round("s");
    // Grace not elapsed: the publisher cannot reclaim yet.
    set_context(&publisher, 122, 0);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.refund_expired(task.clone())
    }));
    assert!(early.is_err(), "refund before reveal_end+100 must abort");
    // Verifier never attests; at reveal_end + 100 the escrow goes back.
    set_context(&publisher, 123, 0);
    c.refund_expired(task.clone());
    assert_eq!(c.get_task(task.clone()).unwrap().state, TaskState::Refunded);
    // Delivering winner: unpaid, but NOT penalised (result was submitted).
    let (a, b, _) = c.get_reputation(acc(&worker));
    assert_eq!((a.as_str(), b.as_str()), ("1", "1"));
    assert!(c.spent_by_agent.get(&acc(&worker)).is_none());
    // A late attest can no longer pay the worker.
    set_context(&publisher, 124, 0);
    let late = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.attest(task.clone(), true)
    }));
    assert!(late.is_err(), "attest after refund must abort (Task is not closed)");
}

#[test]
fn late_attest_settles_while_nobody_refunded() {
    let (mut c, publisher, worker, task) = delivered_round("l");
    // Far past the grace: attest has no deadline and still pays once.
    set_context(&publisher, 10_000, 0);
    c.attest(task.clone(), true);
    assert_eq!(c.get_task(task.clone()).unwrap().state, TaskState::Settled);
    let (a, b, _) = c.get_reputation(acc(&worker));
    assert_eq!((a.as_str(), b.as_str()), ("2", "1"));
    assert_eq!(c.spent_by_agent.get(&acc(&worker)).copied(), Some(REWARD));
    // The settled task cannot be refunded afterwards.
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.refund_expired(task.clone())
    }));
    assert!(again.is_err(), "refund after settlement must abort");
}
