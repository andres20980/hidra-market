// test_salt_entropy.rs v1.0
// RED TEAM: sealed-bid confidentiality vs. salt width. A commitment is
// sha256(price_u64_be || salt_u32_be || account) and get_task exposes it during
// the commit window. Price is low-entropy (a handful of plausible values) and
// the salt is only 32 bits (testnet clients draw 31: randomInt(1, 2**31)), so
// anyone can grind |prices| * 2^32 hashes offline, learn a rival's sealed price
// and commit just below it before the window closes. Test 1 runs that attack
// end-to-end with the victim's salt inside a reduced search window (to keep the
// test fast; the full space only scales the cost linearly). Test 2 pins the salt
// width at the ABI and the full-space cost. Design limit, not a state bug: the
// fix (>=128-bit salt) changes the reveal_bid signature and every client.
use contract::Contract;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{NearToken, testing_env};
use sha2::{Digest, Sha256};

const PUBLISHER: &str = "publisher.testnet";
const VERIFIER: &str = "verifier.testnet";
const VICTIM: &str = "honest.testnet";
const ATTACKER: &str = "grinder.testnet";
const POST_H: u64 = 10;
const COMMIT_LEN: u64 = 5;
const REVEAL_LEN: u64 = 4;
const PRICES: std::ops::RangeInclusive<u64> = 1..=100;
const SALT_WINDOW: u32 = 1 << 12;

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
    let mut h = Sha256::new();
    h.update(price.to_be_bytes());
    h.update(salt.to_be_bytes());
    h.update(worker.as_bytes());
    h.finalize().to_vec()
}

#[test]
fn sealed_price_is_ground_from_public_commitment_and_undercut() {
    let (victim_price, victim_salt) = (37u64, 3_001u32);
    set_context(PUBLISHER, 1, 0);
    let mut c = Contract::init(NearToken::from_near(1).as_yoctonear());
    for w in [VICTIM, ATTACKER] {
        set_context(w, 2, 0);
        c.register_worker();
    }
    set_context(PUBLISHER, POST_H, 1_000_000);
    c.post_task("t".into(), VERIFIER.parse().unwrap(), COMMIT_LEN, REVEAL_LEN);
    set_context(VICTIM, POST_H, 0);
    c.commit_bid("t".into(), commitment(VICTIM, victim_price, victim_salt));

    // Attacker only reads the public view, then grinds (price, salt) offline.
    let task = c.get_task("t".into()).unwrap();
    let target = &task.commitments.iter().find(|e| e.worker.as_str() == VICTIM).unwrap().hash;
    let mut tries = 0u64;
    let found = PRICES.flat_map(|p| (0..SALT_WINDOW).map(move |s| (p, s))).find(|&(p, s)| {
        tries += 1;
        &commitment(VICTIM, p, s) == target
    });
    assert_eq!(found, Some((victim_price, victim_salt)), "sealed bid recovered");
    assert!(tries <= PRICES.count() as u64 * SALT_WINDOW as u64);

    // Still inside the commit window: undercut by one and win the round.
    set_context(ATTACKER, POST_H + 1, 0);
    c.commit_bid("t".into(), commitment(ATTACKER, victim_price - 1, 7));
    let commit_end = POST_H + COMMIT_LEN;
    set_context(VICTIM, commit_end, 0);
    c.reveal_bid("t".into(), victim_price, victim_salt);
    set_context(ATTACKER, commit_end, 0);
    c.reveal_bid("t".into(), victim_price - 1, 7);
    set_context(PUBLISHER, commit_end + REVEAL_LEN, 0);
    c.close_round("t".into());
    let t = c.get_task("t".into()).unwrap();
    assert_eq!(t.winner.as_ref().map(|w| w.as_str()), Some(ATTACKER));
}

#[test]
fn full_salt_space_is_cheap_to_grind() {
    // ABI pin: if reveal_bid widens the salt this stops compiling (re-assess).
    let _abi: fn(&mut Contract, String, u64, u32) = Contract::reveal_bid;
    let full = PRICES.count() as u128 * (u32::MAX as u128 + 1);
    assert_eq!(full, 429_496_729_600);
    // ~2e10 SHA-256/s on one consumer GPU (hashcat -m 1400 public benchmarks):
    let secs = full / 20_000_000_000;
    assert!(secs < 60, "100 prices x 2^32 salts in ~{secs}s on one GPU");
    // A 128-bit salt would make the same search 2^96 times larger.
    assert!(full.checked_mul(1u128 << 96).is_none(), "infeasible with u128 salt");
}
