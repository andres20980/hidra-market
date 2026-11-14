// test_zero_price_bid.rs v2.1
// RED TEAM: zero-price bids used to nullify the reputation weighting
// (RULES.md:23-25). The payout is the escrowed reward, never the bid, so a 0
// bid scored 0*(a+b)/a = 0 and won for any reputation (Beta(1,1000) beat
// Beta(1000,1)). Fixed: reveal_bid requires price > 0 ("Price must be > 0");
// at the minimum price 1 the score is (a+b)/a and reputation decides again.
use contract::{Contract, Reputation, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

const PUBLISHER: &str = "publisher.testnet";
const VERIFIER: &str = "verifier.testnet";
const TRUSTED: &str = "trusted";
const FAILER: &str = "failer";

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

// Mocked storage survives testing_env! within a test thread, so each round
// uses fresh worker accounts and task id (tag) to stay independent.
fn named(role: &str, tag: u64) -> String {
    format!("{role}{tag}.testnet")
}

/// Returns "trusted" or "failer" for the winner of one sealed round.
fn winner(tag: u64, trusted_price: u64, failer_price: u64, failer_beta: u64) -> &'static str {
    let (trusted, failer) = (named(TRUSTED, tag), named(FAILER, tag));
    let task = format!("t{tag}");
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(NearToken::from_near(1).as_yoctonear());
    for w in [&trusted, &failer] {
        set_context(w, 2, 0);
        c.register_worker();
    }
    c.reputations.insert(acc(&trusted), Reputation { alpha: 1000, beta: 1 });
    c.reputations.insert(acc(&failer), Reputation { alpha: 1, beta: failer_beta });
    set_context(PUBLISHER, 3, 1_000_000);
    c.post_task(task.clone(), acc(VERIFIER), 10, 10);
    let bids = [(&trusted, trusted_price, 7_u32), (&failer, failer_price, 9_u32)];
    for (w, price, salt) in bids {
        set_context(w, 4, 0);
        c.commit_bid(task.clone(), commitment(w, price, salt));
    }
    for (w, price, salt) in bids {
        set_context(w, 14, 0);
        c.reveal_bid(task.clone(), price, salt);
    }
    set_context(PUBLISHER, 24, 0);
    c.close_round(task.clone());
    let t = c.get_task(task).unwrap();
    assert_eq!(t.state, TaskState::Closed);
    let w = t.winner.expect("round must have a winner");
    if w == acc(&trusted) { TRUSTED } else { FAILER }
}

#[test]
#[should_panic(expected = "Price must be > 0")]
fn zero_price_reveal_is_rejected() {
    // Beta(1,1000) bidding 0 against Beta(1000,1) bidding 1: the reveal aborts.
    winner(2, 1, 0, 1000);
}

#[test]
fn minimum_price_restores_reputation_weighting() {
    // Control: at equal price 1, reputation decides (1001/1000 vs 1001/1).
    assert_eq!(winner(1, 1, 1, 1000), TRUSTED);
    // Floor price 1 cannot buy a bad record past a trusted worker at 2:
    // 2*1001/1000 = 2.002 < 1*1001/1 = 1001.
    assert_eq!(winner(3, 2, 1, 1000), TRUSTED);
    // Design limit: the bid is a ranking signal, not binding (payout = escrowed
    // reward), so bidding the floor 1 is weakly dominant. A trusted worker
    // quoting an honest 80 scores 80*1001/1000 = 80.08 and loses to Beta(1,50)
    // at 1 (score 51); only by also bidding 1 (score 1.001) does it win again.
    assert_eq!(winner(4, 80, 1, 50), FAILER);
    assert_eq!(winner(5, 1, 1, 50), TRUSTED);
    // Break-even: Beta(1,80) at 1 scores 81 > 80.08, so the record wins again.
    assert_eq!(winner(6, 80, 1, 80), TRUSTED);
}
