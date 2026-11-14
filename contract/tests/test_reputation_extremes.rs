// test_reputation_extremes.rs v1.0
// RED TEAM: arithmetic edges of the reputation-weighted score in close_round.
// test_price_overflow covers u64::MAX prices with the default Beta(1,1) prior;
// here the reputations themselves sit at u64 extremes (crafted state):
//   1) price u64::MAX with alpha ~ u64::MAX vs price 1 with alpha 1 and
//      alpha+beta = u64::MAX: price * (alpha+beta) is ~2^128 and the exact
//      ratio comparison must not overflow nor round; the cheap bid wins by
//      less than 1 unit of score (u64::MAX vs u64::MAX + MAX/(MAX-1));
//   2) alpha + beta == u64::MAX + 1 makes close_round panic with
//      "Reputation overflow" (checked_add, no wrap, no silent winner). This is
//      unreachable on-chain: alpha/beta grow by 1 per attest/refund, so it would
//      take ~1.8e19 settled tasks. Pinned so a future refactor cannot turn it
//      into a wrapping add that picks a wrong winner.
use contract::{Contract, Reputation, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

const PUBLISHER: &str = "publisher.testnet";
const VERIFIER: &str = "verifier.testnet";
const WHALE: &str = "whale.testnet";
const CHEAP: &str = "cheap.testnet";

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

/// Two revealed bids with crafted reputations; returns the contract at the
/// height where close_round is allowed.
fn round(whale_price: u64, whale_rep: Reputation, cheap_rep: Reputation) -> Contract {
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(NearToken::from_near(1).as_yoctonear());
    for w in [WHALE, CHEAP] {
        set_context(w, 2, 0);
        c.register_worker();
    }
    c.reputations.insert(acc(WHALE), whale_rep);
    c.reputations.insert(acc(CHEAP), cheap_rep);
    set_context(PUBLISHER, 3, 1_000_000);
    c.post_task("t".into(), acc(VERIFIER), 10, 10);
    let bids = [(WHALE, whale_price, 11_u32), (CHEAP, 1_u64, 22_u32)];
    for (w, price, salt) in bids {
        set_context(w, 4, 0);
        c.commit_bid("t".into(), commitment(w, price, salt));
    }
    for (w, price, salt) in bids {
        set_context(w, 14, 0);
        c.reveal_bid("t".into(), price, salt);
    }
    set_context(PUBLISHER, 24, 0);
    c
}

#[test]
fn extreme_reputations_compare_exactly_without_overflow() {
    let max = u64::MAX;
    let mut c = round(
        max,
        Reputation { alpha: max - 1, beta: 1 },
        Reputation { alpha: 1, beta: max - 1 },
    );
    c.close_round("t".into());
    let t = c.get_task("t".into()).unwrap();
    assert_eq!(t.state, TaskState::Closed);
    // whale: MAX * MAX / (MAX-1) = MAX + 1 + 1/(MAX-1); cheap: 1 * MAX / 1 = MAX.
    assert_eq!(t.winner, Some(acc(CHEAP)), "exact ratio, cheap wins by <2");

}

#[test]
fn extreme_reputations_trusted_whale_wins_just_below_max() {
    let max = u64::MAX;
    // Mirror: whale price MAX-2 -> (MAX-2)*MAX/(MAX-1) = MAX - 1 - 1/(MAX-1) < MAX.
    let mut c = round(
        max - 2,
        Reputation { alpha: max - 1, beta: 1 },
        Reputation { alpha: 1, beta: max - 1 },
    );
    c.close_round("t".into());
    assert_eq!(
        c.get_task("t".into()).unwrap().winner,
        Some(acc(WHALE)),
        "trusted whale wins once its adjusted score drops below MAX"
    );
}

#[test]
fn reputation_sum_overflow_is_rejected_not_wrapped() {
    let mut c = round(
        u64::MAX,
        Reputation { alpha: u64::MAX, beta: 1 },
        Reputation { alpha: 1, beta: 1 },
    );
    let r = catch_unwind(AssertUnwindSafe(|| c.close_round("t".into())));
    let err = r.expect_err("alpha+beta overflow must abort close_round");
    let msg = err
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    assert!(msg.contains("Reputation overflow"), "{msg}");
}
