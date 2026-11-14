// test_registration_spam.rs v1.0
// RED TEAM: storage griefing through the paths that grow state WITHOUT a deposit.
// `post_task` enforces the storage-reserve invariant (own funds >= staked
// storage + reserve), but `register_worker` and `commit_bid` also grow storage
// and are free. Sybil accounts that only pay gas can register (and commit) until
// the staked storage eats into the escrow the contract owes; the honest payout
// then fails on-chain with `LackBalanceForState`. These tests pin that every
// accepted state-growing call keeps the invariant and the spam is rejected.
use contract::Contract;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{env, testing_env, NearToken};
use std::panic::{catch_unwind, AssertUnwindSafe};

const PUBLISHER: &str = "publisher.testnet";
const VERIFIER: &str = "verifier.testnet";
const REWARD: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR escrow
const MARGIN: u128 = 30_000_000_000_000_000_000_000; // 0.03 NEAR own funds
const RESERVE: u128 = 10_000_000_000_000_000_000_000; // contract STORAGE_RESERVE

/// Mocked env resets `storage_usage` per context, so the test carries it.
fn ctx(who: &str, h: u64, deposit: u128, storage: u64) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(who.parse().unwrap())
        .block_height(h)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_yoctonear(REWARD + MARGIN))
        .storage_usage(storage)
        .build());
}

fn staked(storage: u64) -> u128 {
    env::storage_byte_cost().as_yoctonear() * storage as u128
}

/// Run `f` as `who`; returns new storage usage on success, or the panic text.
fn call(c: &mut Contract, who: &str, h: u64, deposit: u128, storage: u64, f: impl FnOnce(&mut Contract)) -> Result<u64, String> {
    ctx(who, h, deposit, storage);
    catch_unwind(AssertUnwindSafe(|| f(c)))
        .map(|_| {
            flush(c);
            env::storage_usage()
        })
        .map_err(|e| e.downcast_ref::<String>().cloned().unwrap_or_default())
}

/// Mimic the end of a real method call: serialize the state and drop the old
/// instance so the cached collection writes are flushed to (mocked) storage.
fn flush(c: &mut Contract) {
    let bytes = near_sdk::borsh::to_vec(&*c).unwrap();
    let fresh: Contract = near_sdk::borsh::from_slice(&bytes).unwrap();
    drop(std::mem::replace(c, fresh));
}

fn with_honest_escrow() -> (Contract, u64) {
    ctx(PUBLISHER, 1, 0, 0);
    let mut c = Contract::init(REWARD);
    flush(&mut c);
    let s = env::storage_usage();
    let s = call(&mut c, PUBLISHER, 1, REWARD, s, |c| {
        c.post_task("honest".into(), VERIFIER.parse().unwrap(), 1000, 10)
    })
    .expect("honest post");
    (c, s)
}

#[test]
fn sybil_registrations_cannot_eat_into_owed_escrow() {
    let (mut c, mut s) = with_honest_escrow();
    let mut accepted = 0;
    let mut rejected = None;
    for i in 0..2000 {
        let sybil = format!("{:064x}", i); // implicit-style 64-char id
        match call(&mut c, &sybil, 2, 0, s, |c| c.register_worker()) {
            Ok(ns) => {
                s = ns;
                accepted += 1;
                assert!(
                    REWARD + MARGIN - REWARD >= staked(s) + RESERVE,
                    "registration #{accepted} accepted with own funds below stake+reserve"
                );
            }
            Err(msg) => {
                rejected = Some(msg);
                break;
            }
        }
    }
    let msg = rejected.expect("2000 free registrations never rejected: escrow eaten");
    assert!(msg.contains("Storage reserve exhausted"), "{msg}");
    assert!(accepted > 0, "honest registrations must still work under the margin");
}

#[test]
fn sybil_commits_cannot_eat_into_owed_escrow() {
    let (mut c, mut s) = with_honest_escrow();
    let mut committed = 0;
    let mut rejected = None;
    for i in 0..2000 {
        let sybil = format!("{:064x}", i);
        // Register in a roomy context so only the commit is under test.
        let reg = call(&mut c, &sybil, 2, 0, s, |c| c.register_worker());
        let Ok(ns) = reg else { break };
        s = ns;
        match call(&mut c, &sybil, 3, 0, s, |c| c.commit_bid("honest".into(), vec![7u8; 32])) {
            Ok(ns) => {
                s = ns;
                committed += 1;
                assert!(MARGIN >= staked(s) + RESERVE, "commit #{committed} broke the invariant");
            }
            Err(msg) => {
                rejected = Some(msg);
                break;
            }
        }
    }
    // Either path may hit the guard first; what matters is the invariant held.
    assert!(MARGIN >= staked(s) + RESERVE);
    if let Some(msg) = rejected {
        assert!(msg.contains("Storage reserve exhausted"), "{msg}");
    }
}
