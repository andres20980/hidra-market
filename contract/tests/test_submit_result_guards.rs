// test_submit_result_guards.rs v1.0
// RED TEAM: `submit_result` is the only write the winner makes between close
// and payout. If anyone else could write it, or the winner could overwrite it
// after the verifier read it, the verifier would attest a hash it never checked
// (result substitution) and the escrow would pay for unverified work. Pins:
//   1) before close, the lone bidder cannot submit ("Task is not closed");
//   2) loser bidder, publisher, verifier and an outsider are all rejected
//      ("Only the winner can submit a result");
//   3) the winner's second submit is rejected and the first hash is kept;
//   4) empty and 129-byte hashes are rejected, 128 bytes is accepted;
//   5) after attest or refund_expired no one can submit (task leaves Closed).
use contract::{Contract, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

const WINNER: &str = "winner.testnet";
const LOSER: &str = "loser.testnet";
const VERIFIER: &str = "verifier.testnet";
const PUBLISHER: &str = "publisher.testnet";
const OUTSIDER: &str = "outsider.testnet";
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

fn commitment(worker: &str, price: u64, salt: u32) -> Vec<u8> {
    let w: AccountId = worker.parse().unwrap();
    let mut p = Vec::new();
    p.extend_from_slice(&price.to_be_bytes());
    p.extend_from_slice(&salt.to_be_bytes());
    p.extend_from_slice(w.as_str().as_bytes());
    near_sdk::env::sha256(&p)
}

fn rejected(c: &mut Contract, who: &str, height: u64, f: impl FnOnce(&mut Contract)) -> String {
    set_context(who, height, 0);
    let err = catch_unwind(AssertUnwindSafe(|| f(c))).expect_err("call must be rejected");
    err.downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default()
}

/// Two bidders (winner cheaper), revealed; returns the contract still Open.
fn revealed_round() -> Contract {
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(NearToken::from_near(1).as_yoctonear());
    for w in [WINNER, LOSER] {
        set_context(w, 2, 0);
        c.register_worker();
    }
    set_context(PUBLISHER, 3, REWARD);
    c.post_task("t".into(), VERIFIER.parse().unwrap(), 10, 10);
    set_context(WINNER, 4, 0);
    c.commit_bid("t".into(), commitment(WINNER, 5, 1));
    set_context(LOSER, 4, 0);
    c.commit_bid("t".into(), commitment(LOSER, 9, 2));
    set_context(WINNER, 14, 0);
    c.reveal_bid("t".into(), 5, 1);
    set_context(LOSER, 14, 0);
    c.reveal_bid("t".into(), 9, 2);
    c
}

fn closed_round() -> Contract {
    let mut c = revealed_round();
    set_context(OUTSIDER, 24, 0);
    c.close_round("t".into());
    let t = c.get_task("t".into()).unwrap();
    assert_eq!(t.state, TaskState::Closed);
    assert_eq!(t.winner.as_ref().map(|a| a.as_str()), Some(WINNER));
    c
}

#[test]
fn only_the_winner_submits_once_and_only_while_closed() {
    let mut c = revealed_round();
    let e = rejected(&mut c, WINNER, 15, |c| c.submit_result("t".into(), "a".repeat(64)));
    assert!(e.contains("Task is not closed"), "{e}");
    set_context(OUTSIDER, 24, 0);
    c.close_round("t".into());
    let t = c.get_task("t".into()).unwrap();
    assert_eq!(t.winner.as_ref().map(|a| a.as_str()), Some(WINNER));
    for who in [LOSER, PUBLISHER, VERIFIER, OUTSIDER] {
        let e = rejected(&mut c, who, 25, |c| c.submit_result("t".into(), "f".repeat(64)));
        assert!(e.contains("Only the winner can submit a result"), "{who}: {e}");
    }
    assert!(c.get_task("t".into()).unwrap().result_hash.is_none());

    for bad in [String::new(), "x".repeat(129)] {
        let e = rejected(&mut c, WINNER, 25, |c| c.submit_result("t".into(), bad));
        assert!(e.contains("Result hash length out of bounds"), "{e}");
    }
    set_context(WINNER, 25, 0);
    c.submit_result("t".into(), "a".repeat(128));

    let e = rejected(&mut c, WINNER, 26, |c| c.submit_result("t".into(), "b".repeat(64)));
    assert!(e.contains("Result already submitted"), "{e}");
    assert_eq!(c.get_task("t".into()).unwrap().result_hash, Some("a".repeat(128)));
}

#[test]
fn no_submit_after_settlement() {
    let mut c = closed_round();
    set_context(WINNER, 25, 0);
    c.submit_result("t".into(), "a".repeat(64));
    set_context(VERIFIER, 26, 0);
    c.attest("t".into(), true);
    let e = rejected(&mut c, WINNER, 27, |c| c.submit_result("t".into(), "b".repeat(64)));
    assert!(e.contains("Task is not closed"), "{e}");
    assert_eq!(c.get_task("t".into()).unwrap().result_hash, Some("a".repeat(64)));
}

// Each test builds one contract: the mocked storage persists per thread.
#[test]
fn no_submit_after_refund() {
    let mut c = closed_round();
    let reveal_end = c.get_task("t".into()).unwrap().reveal_end;
    set_context(PUBLISHER, reveal_end + GRACE, 0);
    c.refund_expired("t".into());
    assert_eq!(c.get_task("t".into()).unwrap().state, TaskState::Refunded);
    let e = rejected(&mut c, WINNER, reveal_end + GRACE + 1, |c| {
        c.submit_result("t".into(), "a".repeat(64))
    });
    assert!(e.contains("Task is not closed"), "{e}");
    assert!(c.get_task("t".into()).unwrap().result_hash.is_none());
}
