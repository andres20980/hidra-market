// test_selective_reveal_ladder.rs v1.1
// RED TEAM: commit-reveal without a bid bond gives every commitment a free
// option not to reveal. One operator registers a "ladder" of Sybil accounts,
// each committing a different sealed price (10, 20, ..., 90). During the reveal
// window revealed bids are public (get_round), so after the honest worker
// reveals, the operator reveals ONLY the rung just under the honest price and
// abandons the rest. The sealed auction degrades to a reactive one: the
// operator wins at the highest price that still beats the honest bid, and the
// unrevealed rungs cost nothing (no slash, no Beta penalty, no deposit).
// These green tests pin that boundary:
//   1) honest reveals 55 -> operator reveals only 50 and wins at 50 (not 10);
//      honest reveals 15 -> operator reveals only 10 and wins;
//   2) the 8 abandoned commitments stay unrevealed with Beta(1,1) untouched.
// Honest-side mitigation: reveal in the last block of the window (a same-block
// reveal cannot be observed before inclusion). Protocol mitigation would need
// a per-commit bond slashed on non-reveal (state layout change, out of scope
// before the freeze). Documented as a design limit in SECURITY.md.
use contract::Contract;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

const PUBLISHER: &str = "publisher.testnet";
const VERIFIER: &str = "verifier.testnet";
const POST_H: u64 = 10;
const COMMIT_LEN: u64 = 5;
const REVEAL_LEN: u64 = 4;
const SALT: u32 = 0x5eed_0001;

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

// Mocked storage persists across Contract instances in one test, so every
// attack run uses its own account namespace (`tag`).
fn rung(tag: &str, price: u64) -> String {
    format!("{tag}-rung{price}.testnet")
}

fn honest(tag: &str) -> String {
    format!("{tag}-honest.testnet")
}

const LADDER: [u64; 9] = [10, 20, 30, 40, 50, 60, 70, 80, 90];

/// Honest commits `honest_price`, every ladder rung commits its own price.
fn committed_round(tag: &str, id: &str) -> Contract {
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(NearToken::from_near(1).as_yoctonear());
    for w in std::iter::once(honest(tag)).chain(LADDER.iter().map(|p| rung(tag, *p))) {
        set_context(&w, 2, 0);
        c.register_worker();
    }
    set_context(PUBLISHER, POST_H, 1_000_000);
    c.post_task(id.into(), VERIFIER.parse().unwrap(), COMMIT_LEN, REVEAL_LEN);
    c
}

/// Runs the attack: honest reveals first, operator reacts with one rung.
fn run_attack(tag: &str, honest_price: u64) -> (Contract, AccountId, Vec<(AccountId, u64)>) {
    let id = format!("ladder-{tag}");
    let id = id.as_str();
    let mut c = committed_round(tag, id);
    let h = honest(tag);
    set_context(&h, POST_H + 1, 0);
    c.commit_bid(id.into(), commitment(&h, honest_price, SALT));
    for p in LADDER {
        set_context(&rung(tag, p), POST_H + 1, 0);
        c.commit_bid(id.into(), commitment(&rung(tag, p), p, SALT));
    }
    let reveal_h = POST_H + COMMIT_LEN;
    set_context(&h, reveal_h, 0);
    c.reveal_bid(id.into(), honest_price, SALT);

    // Operator observes the public reveal, then picks the best-paying rung.
    let seen = c.get_round(id.into()).unwrap().bids;
    let honest_seen = seen.iter().find(|b| b.worker.as_str() == h).unwrap().price;
    let pick = *LADDER.iter().filter(|p| **p < honest_seen).max().unwrap();
    set_context(&rung(tag, pick), reveal_h + 1, 0);
    c.reveal_bid(id.into(), pick, SALT);

    set_context(PUBLISHER, POST_H + COMMIT_LEN + REVEAL_LEN, 0);
    c.close_round(id.into());
    let round = c.get_round(id.into()).unwrap();
    let bids = round.bids.iter().map(|b| (b.worker.clone(), b.price)).collect();
    (c, round.winner.unwrap(), bids)
}

#[test]
fn ladder_operator_reveals_only_the_rung_under_the_honest_price() {
    let (_, winner, bids) = run_attack("a", 55);
    assert_eq!(winner.as_str(), rung("a", 50), "operator wins at 50, not its floor 10");
    assert_eq!(bids.len(), 2, "only honest + one rung revealed");
    assert!(bids.iter().all(|(w, _)| w.as_str() != rung("a", 10)));

    let (_, winner, bids) = run_attack("b", 15);
    assert_eq!(winner.as_str(), rung("b", 10));
    assert_eq!(bids.iter().find(|(w, _)| w == &winner).unwrap().1, 10);
}

#[test]
fn abandoned_rungs_cost_nothing() {
    let (c, winner, _) = run_attack("c", 55);
    let task = c.get_task("ladder-c".into()).unwrap();
    assert_eq!(task.commitments.len(), 8, "8 rungs never revealed");
    for p in LADDER {
        let acc: AccountId = rung("c", p).parse().unwrap();
        if acc == winner {
            continue;
        }
        let (alpha, beta, _) = c.get_reputation(acc);
        assert_eq!((alpha.as_str(), beta.as_str()), ("1", "1"), "no penalty for rung {p}");
    }
}
