// test_window_boundaries.rs v1.0
// RED TEAM: off-by-one on block windows. A height where commit and reveal both
// work lets a bidder see revealed prices and still commit; a height where close
// works before reveal_end cuts honest reveals; a gap makes a round unclosable.
// These green tests sweep every height around both edges (commit_end and
// reveal_end) and pin that the three phases partition the timeline exactly:
//   [post, commit_end) commit only · [commit_end, reveal_end) reveal only ·
//   [reveal_end, ..) close only. Also: a bidder who withholds a cheaper reveal
//   cannot reveal late, win, or submit.
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

#[test]
fn phases_partition_the_timeline_with_no_overlap_or_gap() {
    let commit_end = POST_H + COMMIT_LEN;
    let reveal_end = commit_end + REVEAL_LEN;
    let heights: Vec<u64> = (POST_H..=reveal_end + 2).collect();
    let ids: Vec<String> = heights
        .iter()
        .flat_map(|h| [format!("c{h}"), format!("r{h}"), format!("x{h}")])
        .collect();
    let mut c = posted(&ids);
    for h in &heights {
        assert!(ok(W1, POST_H, &mut c, |c| c.commit_bid(format!("r{h}"), commitment(W1, 7, 1))));
    }
    for &h in &heights {
        let can_commit = ok(W1, h, &mut c, |c| c.commit_bid(format!("c{h}"), commitment(W1, 7, 1)));
        let can_reveal = ok(W1, h, &mut c, |c| c.reveal_bid(format!("r{h}"), 7, 1));
        let can_close = ok(PUBLISHER, h, &mut c, |c| c.close_round(format!("x{h}")));

        let phase = (can_commit as u8) + (can_reveal as u8) + (can_close as u8);
        assert_eq!(phase, 1, "height {h}: commit={can_commit} reveal={can_reveal} close={can_close}");
        assert_eq!(can_commit, h < commit_end, "commit edge at {h}");
        assert_eq!(can_reveal, h >= commit_end && h < reveal_end, "reveal edge at {h}");
        assert_eq!(can_close, h >= reveal_end, "close edge at {h}");
    }
}

#[test]
fn withheld_cheaper_bid_cannot_reveal_late_win_or_submit() {
    let commit_end = POST_H + COMMIT_LEN;
    let reveal_end = commit_end + REVEAL_LEN;
    let mut c = posted(&["t".to_string()]);
    // W1 commits a cheaper price but withholds its reveal; W2 plays honestly.
    assert!(ok(W1, POST_H, &mut c, |c| c.commit_bid("t".into(), commitment(W1, 3, 9))));
    assert!(ok(W2, POST_H, &mut c, |c| c.commit_bid("t".into(), commitment(W2, 8, 5))));
    assert!(ok(W2, commit_end, &mut c, |c| c.reveal_bid("t".into(), 8, 5)));
    // At reveal_end the reveal window is already shut for the withholder.
    assert!(!ok(W1, reveal_end, &mut c, |c| c.reveal_bid("t".into(), 3, 9)));
    assert!(ok(PUBLISHER, reveal_end, &mut c, |c| c.close_round("t".into())));
    let task = c.get_task("t".into()).unwrap();
    assert_eq!(task.state, TaskState::Closed);
    assert_eq!(task.winner.as_ref().map(|a| a.as_str()), Some(W2));
    // Post-close reveal and submit by the withholder are rejected.
    assert!(!ok(W1, reveal_end + 1, &mut c, |c| c.reveal_bid("t".into(), 3, 9)));
    assert!(!ok(W1, reveal_end + 1, &mut c, |c| c.submit_result("t".into(), "a".repeat(64))));
    assert!(ok(W2, reveal_end + 1, &mut c, |c| c.submit_result("t".into(), "b".repeat(64))));
}
