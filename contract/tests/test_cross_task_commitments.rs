// test_cross_task_commitments.rs v1.0
// RED TEAM: commitment replay across workers and tasks. The commitment is
// sha256(price || salt || account) and is stored per task, so: (1) a rival that
// copies a victim's commitment hash (from get_task or the mempool) can never
// reveal it, even after the victim's (price, salt) becomes public in another
// task; (2) a reveal only consumes the commitment of the task it names, so a
// worker bidding in two rounds cannot cross-reveal or double-count; (3) a task
// with no commitment rejects reveals. Known design limit pinned here: the hash
// does not bind task_id, so reusing (price, salt) across tasks leaks the price
// of the still-sealed round once the first one is revealed (RULES: fresh salt).
use contract::{Contract, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

const PUBLISHER: &str = "publisher.testnet";
const VERIFIER: &str = "verifier.testnet";
const W1: &str = "w1.testnet";
const W2: &str = "w2.testnet";
const POST_H: u64 = 10;
const COMMIT_LEN: u64 = 5;
const REVEAL_LEN: u64 = 4;

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

fn ok(who: &str, h: u64, c: &mut Contract, f: impl FnOnce(&mut Contract)) -> bool {
    set_context(who, h, 0);
    catch_unwind(AssertUnwindSafe(|| f(c))).is_ok()
}

/// Contract with W1/W2 registered and the given tasks posted at POST_H.
/// Mocked storage persists across `testing_env!`, so one contract per test.
fn posted(ids: &[String]) -> Contract {
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(NearToken::from_near(1).as_yoctonear());
    for w in [W1, W2] {
        set_context(w, 2, 0);
        c.register_worker();
    }
    for id in ids {
        set_context(PUBLISHER, POST_H, 1_000_000);
        c.post_task(id.clone(), VERIFIER.parse().unwrap(), COMMIT_LEN, REVEAL_LEN);
    }
    c
}

fn err(who: &str, h: u64, c: &mut Contract, f: impl FnOnce(&mut Contract)) -> String {
    set_context(who, h, 0);
    let e = catch_unwind(AssertUnwindSafe(|| f(c))).expect_err("call should have failed");
    e.downcast_ref::<String>()
        .cloned()
        .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default()
}

#[test]
fn copied_commitment_cannot_be_revealed_by_another_worker() {
    let commit_end = POST_H + COMMIT_LEN;
    let reveal_end = commit_end + REVEAL_LEN;
    let mut c = posted(&["a".to_string(), "b".to_string()]);
    let victim = commitment(W1, 9, 42);
    // W2 copies W1's hash into both rounds; W1 bids in round a only.
    assert!(ok(W1, POST_H, &mut c, |c| c.commit_bid("a".into(), victim.clone())));
    assert!(ok(W2, POST_H, &mut c, |c| c.commit_bid("a".into(), victim.clone())));
    assert!(ok(W2, POST_H, &mut c, |c| c.commit_bid("b".into(), victim.clone())));
    // W1 reveals in a: (9, 42) is now public. W2 replays it in both rounds.
    assert!(ok(W1, commit_end, &mut c, |c| c.reveal_bid("a".into(), 9, 42)));
    for id in ["a", "b"] {
        let m = err(W2, commit_end, &mut c, |c| c.reveal_bid(id.into(), 9, 42));
        assert!(m.contains("Reveal does not match commitment"), "{id}: {m}");
    }
    // The copier ends with no bid anywhere; the victim wins a, b has no winner.
    for id in ["a", "b"] {
        assert!(ok(PUBLISHER, reveal_end, &mut c, |c| c.close_round(id.into())));
    }
    let a = c.get_task("a".into()).unwrap();
    assert_eq!(a.bids.len(), 1);
    assert_eq!(a.winner.as_ref().map(|w| w.as_str()), Some(W1));
    let b = c.get_task("b".into()).unwrap();
    assert!(b.bids.is_empty() && b.winner.is_none(), "{b:?}");
    assert_eq!(b.state, TaskState::Closed, "bidless round closes with no winner (refund path)");
}

#[test]
fn reveal_only_consumes_the_named_task_commitment() {
    let commit_end = POST_H + COMMIT_LEN;
    let mut c = posted(&["a".to_string(), "b".to_string(), "empty".to_string()]);
    assert!(ok(W1, POST_H, &mut c, |c| c.commit_bid("a".into(), commitment(W1, 5, 1))));
    assert!(ok(W1, POST_H, &mut c, |c| c.commit_bid("b".into(), commitment(W1, 7, 2))));
    // a's opening does not open b, and vice versa.
    let m = err(W1, commit_end, &mut c, |c| c.reveal_bid("b".into(), 5, 1));
    assert!(m.contains("Reveal does not match commitment"), "{m}");
    let m = err(W1, commit_end, &mut c, |c| c.reveal_bid("empty".into(), 5, 1));
    assert!(m.contains("No commitment for worker"), "{m}");
    assert!(ok(W1, commit_end, &mut c, |c| c.reveal_bid("a".into(), 5, 1)));
    // Replaying a's reveal is rejected: the commitment was consumed.
    let m = err(W1, commit_end, &mut c, |c| c.reveal_bid("a".into(), 5, 1));
    assert!(m.contains("No commitment for worker"), "{m}");
    let b = c.get_task("b".into()).unwrap();
    assert_eq!(b.commitments.len(), 1);
    assert!(b.bids.is_empty());
    assert!(ok(W1, commit_end, &mut c, |c| c.reveal_bid("b".into(), 7, 2)));
    let a = c.get_task("a".into()).unwrap();
    let b = c.get_task("b".into()).unwrap();
    assert_eq!((a.bids.len(), a.bids[0].price), (1, 5));
    assert_eq!((b.bids.len(), b.bids[0].price), (1, 7));
}

#[test]
fn reused_salt_across_tasks_yields_identical_hash_design_limit() {
    // Pins the documented limit: same (price, salt, account) => same hash in
    // every task, so an observer links rounds and learns the sealed price once
    // one round is revealed. Defence is client-side (fresh random salt).
    let mut c = posted(&["a".to_string(), "b".to_string()]);
    let h = commitment(W1, 4, 3);
    assert!(ok(W1, POST_H, &mut c, |c| c.commit_bid("a".into(), h.clone())));
    assert!(ok(W1, POST_H, &mut c, |c| c.commit_bid("b".into(), h.clone())));
    let a = c.get_task("a".into()).unwrap();
    let b = c.get_task("b".into()).unwrap();
    assert_eq!(a.commitments[0].hash, b.commitments[0].hash);
    assert_ne!(commitment(W1, 4, 3), commitment(W1, 4, 4), "fresh salt unlinks rounds");
}
