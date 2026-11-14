// test_close_round_many_bids.rs v1.0
// RED TEAM: a task has no cap on commitments/bids. Sybil workers flood one round
// so that close_round (one reputation read per bid) and the honest commit_bid
// (whole Task re-serialised per call) blow the gas budget and the round cannot
// close, freezing the honest escrow. Measures host-side gas (mocked VM: storage
// and hashing, not wasm instructions, so a lower bound) at N and 2N bids and
// pins: the honest bidder still wins, cost grows ~linearly, and the
// extrapolated bid count to hit 300 Tgas stays well above MAX_BIDS_PER_TASK,
// and commit_bid rejects the bid past the cap (fix for the freeze found here:
// before the cap, ~3.9k Sybil bids made close_round unrunnable).
use contract::{Contract, MAX_BIDS_PER_TASK, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, env, testing_env};

const PUBLISHER: &str = "publisher.testnet";
const VERIFIER: &str = "verifier.testnet";
const HONEST: &str = "honest.testnet";
const TX_CAP_GAS: u64 = 300_000_000_000_000;

fn set_context(predecessor: &str, block_height: u64, deposit: u128) {
    testing_env!(
        VMContextBuilder::new()
            .predecessor_account_id(predecessor.parse().unwrap())
            .block_height(block_height)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(1_000))
            .prepaid_gas(near_sdk::Gas::from_gas(TX_CAP_GAS))
            .build()
    );
}

fn commitment(worker: &str, price: u64, salt: u32) -> Vec<u8> {
    let w: AccountId = worker.parse().unwrap();
    let mut p = Vec::new();
    p.extend_from_slice(&price.to_be_bytes());
    p.extend_from_slice(&salt.to_be_bytes());
    p.extend_from_slice(w.as_str().as_bytes());
    env::sha256(&p)
}

/// Returns (gas of the honest commit_bid after `n` Sybil commits, gas of close_round).
fn flood(n: usize) -> (u64, u64) {
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(NearToken::from_near(100).as_yoctonear());
    let sybils: Vec<String> = (0..n).map(|i| format!("sybil{i:05}.testnet")).collect();
    for w in sybils.iter().map(String::as_str).chain([HONEST]) {
        set_context(w, 2, 0);
        c.register_worker();
    }
    set_context(PUBLISHER, 10, NearToken::from_near(1).as_yoctonear());
    c.post_task("t".into(), VERIFIER.parse().unwrap(), 5, 5);
    for (i, w) in sybils.iter().enumerate() {
        set_context(w, 11, 0);
        c.commit_bid("t".into(), commitment(w, 1_000 + i as u64, 7));
    }
    set_context(HONEST, 11, 0);
    let g0 = env::used_gas().as_gas();
    c.commit_bid("t".into(), commitment(HONEST, 10, 9));
    let commit_gas = env::used_gas().as_gas() - g0;
    for (i, w) in sybils.iter().enumerate() {
        set_context(w, 15, 0);
        c.reveal_bid("t".into(), 1_000 + i as u64, 7);
    }
    set_context(HONEST, 15, 0);
    c.reveal_bid("t".into(), 10, 9);
    set_context(PUBLISHER, 20, 0);
    let g0 = env::used_gas().as_gas();
    c.close_round("t".into());
    let close_gas = env::used_gas().as_gas() - g0;
    let task = c.get_task("t".into()).expect("task");
    assert_eq!(task.state, TaskState::Closed);
    assert_eq!(task.bids.len(), n + 1);
    assert_eq!(task.winner.map(|w| w.to_string()).as_deref(), Some(HONEST));
    (commit_gas, close_gas)
}

#[test]
fn bid_flood_cannot_freeze_close_round() {
    const N: usize = 150;
    // Mocked storage is thread-local: one fresh thread per flood size.
    let run = |n: usize| std::thread::spawn(move || flood(n)).join().expect("flood panicked");
    let (commit_n, close_n) = run(N);
    let (commit_2n, close_2n) = run(2 * N);
    let close_slope = (close_2n - close_n) / N as u64;
    let commit_slope = (commit_2n - commit_n) / N as u64;
    let close_bids_to_cap = (TX_CAP_GAS - close_2n) / close_slope.max(1) + 2 * N as u64;
    let commit_bids_to_cap = (TX_CAP_GAS - commit_2n) / commit_slope.max(1) + 2 * N as u64;
    println!(
        "close_round host gas: {N} bids {:.3} Tgas, {} bids {:.3} Tgas, slope {:.2} Ggas/bid, ~{close_bids_to_cap} bids to 300 Tgas",
        close_n as f64 / 1e12, 2 * N, close_2n as f64 / 1e12, close_slope as f64 / 1e9
    );
    println!(
        "honest commit_bid host gas: after {N} {:.3} Tgas, after {} {:.3} Tgas, slope {:.2} Ggas/commit, ~{commit_bids_to_cap} commits to 300 Tgas",
        commit_n as f64 / 1e12, 2 * N, commit_2n as f64 / 1e12, commit_slope as f64 / 1e9
    );
    assert!(close_2n > close_n, "close_round cost should grow with bids");
    assert!(close_2n < 2 * close_n + 5_000_000_000_000, "close_round grows super-linearly");
    assert!(
        close_bids_to_cap > 4 * MAX_BIDS_PER_TASK as u64,
        "close_round reaches 300 Tgas at only {close_bids_to_cap} bids"
    );
    let at_cap = close_n + close_slope * (MAX_BIDS_PER_TASK - N) as u64;
    assert!(at_cap < TX_CAP_GAS / 4, "close_round at the cap needs {at_cap} host gas");
    assert!(commit_bids_to_cap > 1_000, "commit_bid reaches 300 Tgas at only {commit_bids_to_cap} commits");
}

#[test]
fn commit_past_bid_cap_is_rejected_and_round_still_settles_honestly() {
    std::thread::spawn(|| {
        set_context(PUBLISHER, 1, 0);
        let mut c = Contract::init(NearToken::from_near(100).as_yoctonear());
        let sybils: Vec<String> = (0..MAX_BIDS_PER_TASK - 1).map(|i| format!("s{i:04}.testnet")).collect();
        for w in sybils.iter().map(String::as_str).chain([HONEST, "late.testnet"]) {
            set_context(w, 2, 0);
            c.register_worker();
        }
        set_context(PUBLISHER, 10, NearToken::from_near(1).as_yoctonear());
        c.post_task("t".into(), VERIFIER.parse().unwrap(), 5, 5);
        for w in &sybils {
            set_context(w, 11, 0);
            c.commit_bid("t".into(), commitment(w, 1_000, 7));
        }
        set_context(HONEST, 11, 0);
        c.commit_bid("t".into(), commitment(HONEST, 10, 9));
        set_context("late.testnet", 11, 0);
        let late = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.commit_bid("t".into(), commitment("late.testnet", 5, 1))
        }));
        assert!(late.is_err(), "bid #{} past the cap was accepted", MAX_BIDS_PER_TASK + 1);
        set_context(HONEST, 15, 0);
        c.reveal_bid("t".into(), 10, 9);
        set_context(PUBLISHER, 20, 0);
        c.close_round("t".into());
        let task = c.get_task("t".into()).expect("task");
        assert_eq!(task.winner.map(|w| w.to_string()).as_deref(), Some(HONEST));
        set_context(HONEST, 21, 0);
        c.submit_result("t".into(), "ab".repeat(32));
        set_context(VERIFIER, 22, 0);
        c.attest("t".into(), true);
        assert_eq!(c.get_task("t".into()).expect("task").state, TaskState::Settled);
    })
    .join()
    .expect("capped round failed");
}
