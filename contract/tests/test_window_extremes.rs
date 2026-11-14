// test_window_extremes.rs v1.0
// RED TEAM: extreme commit/reveal window lengths in post_task. Heights are
// u64, so a hostile publisher can try to wrap commit_end/reveal_end or park a
// round so far in the future that it never closes. Expected: wrapping aborts
// (checked_add), an unreachable round never pays or refunds early, and the
// refund height overflow fails closed instead of wrapping to an early refund.
use contract::{Contract, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

const PUBLISHER: &str = "publisher.testnet";
const VERIFIER: &str = "verifier.testnet";
const WORKER: &str = "worker.testnet";
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

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn market() -> Contract {
    set_context(PUBLISHER, 1, 0);
    Contract::init(NearToken::from_near(1).as_yoctonear())
}

#[test]
#[should_panic(expected = "Commit window overflow")]
fn commit_len_that_wraps_the_height_is_rejected() {
    let mut c = market();
    set_context(PUBLISHER, 5, REWARD);
    c.post_task("wrap-commit".into(), acc(VERIFIER), u64::MAX, 10);
}

#[test]
#[should_panic(expected = "Reveal window overflow")]
fn reveal_len_that_wraps_the_height_is_rejected() {
    let mut c = market();
    set_context(PUBLISHER, 5, REWARD);
    c.post_task("wrap-reveal".into(), acc(VERIFIER), 10, u64::MAX - 10);
}

#[test]
fn unreachable_round_locks_only_the_publisher_escrow() {
    // reveal_end ~1.8e19 blocks away: a "lure" round. Workers can commit (they
    // must read reveal_end before bidding), but nobody can close, pay or refund.
    let mut c = market();
    set_context(PUBLISHER, 5, REWARD);
    c.post_task("lure".into(), acc(VERIFIER), 10, u64::MAX - 100);
    let t = c.get_task("lure".into()).unwrap();
    assert_eq!(t.reveal_end, u64::MAX - 85);

    set_context(WORKER, 6, 0);
    c.register_worker();
    c.commit_bid("lure".into(), vec![7_u8; 32]);

    // A realistic future height (testnet ~2e8 today) is still inside the round.
    set_context(PUBLISHER, 1_000_000_000, 0);
    let close = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.close_round("lure".into())
    }));
    assert!(close.is_err(), "close_round must not open before reveal_end");
    let refund = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.refund_expired("lure".into())
    }));
    assert!(refund.is_err(), "refund_expired must not run on an open round");

    // Other markets are unaffected: an honest round posted later still settles.
    set_context(PUBLISHER, 1_000_000_000, REWARD);
    c.post_task("honest".into(), acc(VERIFIER), 0, 0);
    c.close_round("honest".into());
    assert_eq!(c.get_task("honest".into()).unwrap().state, TaskState::Closed);
    assert_eq!(c.get_task("lure".into()).unwrap().state, TaskState::Open);
}

#[test]
#[should_panic(expected = "Refund height overflow")]
fn refund_height_overflow_fails_closed() {
    // reveal_end + REFUND_GRACE_BLOCKS (100) exceeds u64::MAX: refund_expired
    // must abort, never wrap to a small height that would allow an early refund.
    let mut c = market();
    set_context(PUBLISHER, 5, REWARD);
    c.post_task("edge".into(), acc(VERIFIER), 0, u64::MAX - 55);
    set_context(PUBLISHER, u64::MAX - 50, 0);
    c.close_round("edge".into());
    assert_eq!(c.get_task("edge".into()).unwrap().state, TaskState::Closed);
    c.refund_expired("edge".into());
}
