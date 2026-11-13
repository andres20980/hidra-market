// test_collusive_verifier_reputation.rs v1.0
// RED TEAM: the task publisher freely names the `verifier` in post_task, and an
// `ok` attest is the ONLY thing that raises a worker's Beta `alpha`. NEAR has no
// on-chain identity, so one operator can hold publisher + worker + verifier
// accounts and run self-dealing rounds: the Sybil worker is the lone bidder,
// wins, submits, and the operator's own verifier attests `ok`. The reward just
// cycles from the operator's escrow back to the operator's worker (gas only),
// yet `alpha` climbs every round. These green tests pin that boundary end-to-end
// through the real post_task -> ... -> attest path (not by poking the map):
//   1) reputation is pumpable at near-zero cost with no honest counterparty;
//   2) a pumped Sybil then WINS an honest market while bidding ~70% more than a
//      cheaper honest worker, because close_round weights price by 1/mean(Beta).
// This is a documented design limitation (reputation-weighted selection assumes
// verifiers are independent of workers), NOT a contract bug. Mitigation would
// need off-chain identity/verifier staking; see SECURITY.md. Complements
// test_sybil_two_accounts.rs (per-account cap boundary) and test_tie_break.rs
// (the reputation-weighted selection math in isolation).
use contract::{Contract, Reputation};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

const SYBIL: &str = "sybil.testnet";
const VERIFIER: &str = "sybil-verifier.testnet"; // same operator as SYBIL + publisher
const PUBLISHER: &str = "sybil-publisher.testnet";

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

fn bid_commitment(worker: &AccountId, price: u64, salt: u32) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&price.to_be_bytes());
    payload.extend_from_slice(&salt.to_be_bytes());
    payload.extend_from_slice(worker.as_str().as_bytes());
    near_sdk::env::sha256(&payload)
}

fn reputation(contract: &Contract, account: &str) -> Reputation {
    contract
        .reputations
        .get(&account.parse::<AccountId>().unwrap())
        .cloned()
        .unwrap_or(Reputation { alpha: 1, beta: 1 })
}

/// One fully self-dealt round: publisher posts, Sybil is the lone bidder and
/// wins, submits a result, and the colluding verifier attests `ok`. Returns with
/// the Sybil worker's `alpha` incremented by one. `round` spaces the block
/// heights so successive rounds never overlap their commit/reveal windows.
fn collude_round(contract: &mut Contract, round: u64) {
    let base = round * 100 + 1;
    let id = format!("c-{round}");
    let sybil: AccountId = SYBIL.parse().unwrap();

    set_context(PUBLISHER, base, 1); // reward = 1 yocto; it returns to the operator
    contract.post_task(id.clone(), VERIFIER.parse().unwrap(), 10, 10);

    set_context(SYBIL, base + 1, 0);
    contract.commit_bid(id.clone(), bid_commitment(&sybil, 7, round as u32));

    set_context(SYBIL, base + 11, 0);
    contract.reveal_bid(id.clone(), 7, round as u32);

    set_context(PUBLISHER, base + 21, 0);
    contract.close_round(id.clone());

    set_context(SYBIL, base + 22, 0);
    contract.submit_result(id.clone(), "a".repeat(32));

    set_context(VERIFIER, base + 23, 0);
    contract.attest(id, true);
}

#[test]
fn collusive_verifier_pumps_reputation_at_near_zero_cost() {
    set_context(PUBLISHER, 1, 0);
    let mut contract = Contract::init(NearToken::from_near(1).as_yoctonear());
    set_context(SYBIL, 1, 0);
    contract.register_worker();

    // Prior is Beta(1,1): alpha starts at 1.
    assert_eq!(reputation(&contract, SYBIL).alpha, 1);

    const PUMP: u64 = 8;
    for round in 1..=PUMP {
        collude_round(&mut contract, round);
    }

    // Every self-dealt `ok` added exactly 1 to alpha; beta never moved.
    let rep = reputation(&contract, SYBIL);
    assert_eq!(rep.alpha, 1 + PUMP, "each colluding attest raises alpha by 1");
    assert_eq!(rep.beta, 1, "no honest failure ever recorded a beta");
}

#[test]
fn pumped_sybil_outbids_a_cheaper_honest_worker() {
    set_context(PUBLISHER, 1, 0);
    let mut contract = Contract::init(NearToken::from_near(1).as_yoctonear());
    set_context(SYBIL, 1, 0);
    contract.register_worker();

    const PUMP: u64 = 8;
    for round in 1..=PUMP {
        collude_round(&mut contract, round);
    }
    // After pumping: Sybil is Beta(9,1), an honest newcomer is Beta(1,1).
    assert_eq!(reputation(&contract, SYBIL).alpha, 1 + PUMP);

    // Honest market: an honest worker bids 10, the Sybil bids 17 (70% dearer).
    // adjusted(sybil)  = 17 * (9+1)/9  = 18.9
    // adjusted(honest) = 10 * (1+1)/1  = 20.0  -> Sybil wins despite charging more.
    let base = 10_000;
    let honest: AccountId = "honest.testnet".parse().unwrap();
    let sybil: AccountId = SYBIL.parse().unwrap();

    set_context(PUBLISHER, base, 1);
    contract.post_task("market".to_string(), VERIFIER.parse().unwrap(), 10, 10);
    set_context("honest.testnet", base, 0);
    contract.register_worker();

    set_context("honest.testnet", base + 1, 0);
    contract.commit_bid("market".to_string(), bid_commitment(&honest, 10, 1));
    set_context(SYBIL, base + 1, 0);
    contract.commit_bid("market".to_string(), bid_commitment(&sybil, 17, 2));

    set_context("honest.testnet", base + 11, 0);
    contract.reveal_bid("market".to_string(), 10, 1);
    set_context(SYBIL, base + 11, 0);
    contract.reveal_bid("market".to_string(), 17, 2);

    set_context(PUBLISHER, base + 21, 0);
    contract.close_round("market".to_string());

    let winner = contract
        .tasks
        .get(&"market".to_string())
        .unwrap()
        .winner
        .clone()
        .map(|a| a.to_string());
    assert_eq!(
        winner,
        Some(SYBIL.to_string()),
        "pumped reputation lets the Sybil win while bidding 70% above the honest worker"
    );
}

#[test]
fn control_without_pump_the_cheaper_honest_worker_wins() {
    // Same final market, but the Sybil never pumped: Beta(1,1) vs Beta(1,1).
    // adjusted(sybil) = 17 * 2/1 = 34 ; adjusted(honest) = 10 * 2/1 = 20 -> honest.
    set_context(PUBLISHER, 1, 0);
    let mut contract = Contract::init(NearToken::from_near(1).as_yoctonear());

    let base = 10_000;
    let honest: AccountId = "honest.testnet".parse().unwrap();
    let sybil: AccountId = SYBIL.parse().unwrap();

    set_context(PUBLISHER, base, 1);
    contract.post_task("market".to_string(), VERIFIER.parse().unwrap(), 10, 10);
    set_context("honest.testnet", base, 0);
    contract.register_worker();
    set_context(SYBIL, base, 0);
    contract.register_worker();

    set_context("honest.testnet", base + 1, 0);
    contract.commit_bid("market".to_string(), bid_commitment(&honest, 10, 1));
    set_context(SYBIL, base + 1, 0);
    contract.commit_bid("market".to_string(), bid_commitment(&sybil, 17, 2));

    set_context("honest.testnet", base + 11, 0);
    contract.reveal_bid("market".to_string(), 10, 1);
    set_context(SYBIL, base + 11, 0);
    contract.reveal_bid("market".to_string(), 17, 2);

    set_context(PUBLISHER, base + 21, 0);
    contract.close_round("market".to_string());

    let winner = contract
        .tasks
        .get(&"market".to_string())
        .unwrap()
        .winner
        .clone()
        .map(|a| a.to_string());
    assert_eq!(winner, Some("honest.testnet".to_string()));
}
