// test_escrow_ledger_invariant.rs v1.0
// RED TEAM: the storage-reserve guard trusts a running escrow total stored under
// the raw key b"e" (post_task adds, attest/refund_expired subtract with
// saturating_sub). If that total drifted from reality, the guard would either
// under-count liabilities (spam could again freeze honest escrows) or
// over-count them (honest post_task rejected forever). These green tests pin:
//   1) after every call of a seeded mixed workload (settle, attest(false),
//      cap-overflow refund, no-bid refund, silent-winner refund, tasks left
//      Open/Closed) b"e" == sum of rewards of Open|Closed tasks, and
//      posted == paid + refunded + b"e" (no yocto created or lost);
//   2) legacy state without b"e" (contract deployed before the key existed):
//      the first post_task rebuilds the total from a scan, then stays exact.
use contract::{Contract, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{NearToken, env, testing_env};

const VERIFIER: &str = "verifier.testnet";
const PUBLISHER: &str = "publisher.testnet";
const WORKERS: [&str; 3] = ["w0.testnet", "w1.testnet", "w2.testnet"];
const GRACE: u64 = 100;
const CAP: u128 = 3_000_000;

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
    env::sha256(&p)
}

fn ledger() -> Option<u128> {
    env::storage_read(b"e").map(|b| u128::from_le_bytes(b.try_into().unwrap()))
}

fn owed(c: &Contract, ids: &[String]) -> u128 {
    ids.iter()
        .map(|id| c.get_task(id.clone()).unwrap())
        .filter(|t| matches!(t.state, TaskState::Open | TaskState::Closed))
        .map(|t| t.reward.as_yoctonear())
        .sum()
}

fn exited(c: &Contract, ids: &[String]) -> u128 {
    ids.iter()
        .map(|id| c.get_task(id.clone()).unwrap())
        .filter(|t| matches!(t.state, TaskState::Settled | TaskState::Refunded))
        .map(|t| t.reward.as_yoctonear())
        .sum()
}

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
}

fn assert_ledger(c: &Contract, ids: &[String], posted: u128, step: &str) {
    let e = ledger().expect("b\"e\" must exist after post_task");
    assert_eq!(e, owed(c, ids), "b\"e\" drifted from Open|Closed rewards at {step}");
    assert_eq!(posted, exited(c, ids) + e, "yocto created/lost at {step}");
}

/// Runs one task to the given outcome starting at height `h`; returns next free height.
fn run_task(c: &mut Contract, id: &str, reward: u128, outcome: u64, worker: &str, h: u64) -> u64 {
    set_context(PUBLISHER, h, reward);
    c.post_task(id.into(), VERIFIER.parse().unwrap(), 10, 10);
    let reveal_end = c.get_task(id.into()).unwrap().reveal_end;
    if outcome == 5 {
        return h + 1; // left Open forever
    }
    if outcome != 3 {
        set_context(worker, h + 1, 0);
        c.commit_bid(id.into(), commitment(worker, 7, 42));
        set_context(worker, h + 11, 0);
        c.reveal_bid(id.into(), 7, 42);
    }
    set_context(PUBLISHER, reveal_end, 0);
    c.close_round(id.into());
    match outcome {
        0 | 1 | 6 => {
            set_context(worker, reveal_end + 1, 0);
            c.submit_result(id.into(), "a".repeat(64));
            if outcome != 6 {
                set_context(VERIFIER, reveal_end + 2, 0);
                c.attest(id.into(), outcome == 0);
            }
        }
        _ => {
            set_context(PUBLISHER, reveal_end + GRACE, 0);
            c.refund_expired(id.into());
        }
    }
    reveal_end + GRACE + 1
}

#[test]
fn escrow_total_matches_open_tasks_under_mixed_workload() {
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(CAP);
    for (i, w) in WORKERS.iter().enumerate() {
        set_context(w, 2 + i as u64, 0);
        c.register_worker();
    }
    let mut rng = Lcg(0x5eed);
    let (mut ids, mut posted, mut h) = (Vec::new(), 0u128, 10u64);
    let mut seen = [0u32; 7];
    for i in 0..120 {
        let id = format!("t{i}");
        let reward = 1 + u128::from(rng.next() % 1_000_000);
        let outcome = rng.next() % 7;
        let worker = WORKERS[(rng.next() % 3) as usize];
        h = run_task(&mut c, &id, reward, outcome, worker, h);
        ids.push(id.clone());
        posted += reward;
        let state = c.get_task(id.clone()).unwrap().state;
        // outcome 0 past the per-agent cap ends Refunded, not Settled.
        let kind = if outcome == 0 && state == TaskState::Refunded { 2 } else { outcome as usize };
        seen[kind] += 1;
        assert_ledger(&c, &ids, posted, &id);
    }
    assert!(seen.iter().all(|&n| n > 0), "every exit path exercised: {seen:?}");
    assert!(ledger().unwrap() > 0, "some escrow still owed (Open/Closed left)");
}

#[test]
fn legacy_state_without_key_rebuilds_total_on_first_post() {
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(CAP);
    set_context(WORKERS[0], 2, 0);
    c.register_worker();
    let mut ids = Vec::new();
    let mut h = 10;
    for (i, (reward, outcome)) in [(500u128, 5u64), (700, 6), (900, 0), (300, 1)].iter().enumerate() {
        let id = format!("l{i}");
        h = run_task(&mut c, &id, *reward, *outcome, WORKERS[0], h);
        ids.push(id);
    }
    assert_eq!(ledger(), Some(1200), "Open 500 + Closed 700");

    // Simulate state written by the pre-key contract version.
    env::storage_remove(b"e");
    assert_eq!(ledger(), None);

    h = run_task(&mut c, "l4", 250, 5, WORKERS[0], h);
    ids.push("l4".into());
    assert_eq!(ledger(), Some(1450), "scan fallback 1200 + new 250");

    set_context(VERIFIER, h, 0);
    c.attest("l1".into(), true);
    assert_eq!(ledger(), Some(750), "settling Closed 700 releases exactly it");
    assert_ledger(&c, &ids, 500 + 700 + 900 + 300 + 250, "legacy");
}
