// test_tie_break.rs v1.1
use contract::{Contract, Reputation};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

fn set_context(predecessor: &str, block_height: u64, deposit: u128) {
    testing_env!(
        VMContextBuilder::new()
            .predecessor_account_id(predecessor.parse().unwrap())
            .block_height(block_height)
            .attached_deposit(NearToken::from_yoctonear(deposit))
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

fn prepare_round(bids: &[(&str, u64, u32)]) -> Contract {
    set_context("publisher.testnet", 1, 100);
    let mut contract = Contract::init(1_000);
    contract.post_task(
        "task-1".to_string(),
        "verifier.testnet".parse().unwrap(),
        10,
        10,
    );
    for (w, _, _) in bids {
        set_context(w, 2, 0);
        contract.register_worker();
    }
    for (w, price, salt) in bids {
        set_context(w, 3, 0);
        let worker: AccountId = w.parse().unwrap();
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, *price, *salt));
    }
    for (w, price, salt) in bids {
        set_context(w, 11, 0);
        contract.reveal_bid("task-1".to_string(), *price, *salt);
    }
    contract
}

fn close_round(contract: &mut Contract) {
    set_context("publisher.testnet", 21, 0);
    contract.close_round("task-1".to_string());
}

fn winner(contract: &Contract) -> Option<String> {
    contract
        .tasks
        .get(&"task-1".to_string())
        .unwrap()
        .winner
        .clone()
        .map(|a| a.to_string())
}

#[test]
fn r8_1_equal_price_and_reputation_picks_lexicographically_smaller_account() {
    let mut contract = prepare_round(&[("bbb.testnet", 5, 1), ("aaa.testnet", 5, 2)]);
    close_round(&mut contract);
    assert_eq!(winner(&contract), Some("aaa.testnet".to_string()));
}

#[test]
fn r8_2_same_price_higher_reputation_wins() {
    let mut contract = prepare_round(&[("low.testnet", 5, 1), ("high.testnet", 5, 2)]);
    contract.reputations.insert(
        "high.testnet".parse().unwrap(),
        Reputation { alpha: 9, beta: 1 },
    );
    close_round(&mut contract);
    assert_eq!(winner(&contract), Some("high.testnet".to_string()));
}

#[test]
fn r8_3_equal_adjusted_price_picks_lower_nominal_price() {
    // cheap: 4 * (1+3)/1 = 16 ; dear: 8 * (1+1)/1 = 16 -> tie -> lower price wins
    let mut contract = prepare_round(&[("cheap.testnet", 4, 1), ("dear.testnet", 8, 2)]);
    contract.reputations.insert(
        "cheap.testnet".parse().unwrap(),
        Reputation { alpha: 1, beta: 3 },
    );
    close_round(&mut contract);
    assert_eq!(winner(&contract), Some("cheap.testnet".to_string()));
}

#[test]
fn r8_4_worker_with_zero_alpha_reputation_is_skipped() {
    let mut contract = prepare_round(&[("zero.testnet", 1, 1), ("normal.testnet", 9, 2)]);
    contract.reputations.insert(
        "zero.testnet".parse().unwrap(),
        Reputation { alpha: 0, beta: 5 },
    );
    close_round(&mut contract);
    assert_eq!(winner(&contract), Some("normal.testnet".to_string()));
}

#[test]
fn r8_5_equal_adjusted_price_and_nominal_price_prefers_more_reputation_history() {
    let mut contract = prepare_round(&[("new.testnet", 3, 1), ("established.testnet", 3, 2)]);
    contract.reputations.insert(
        "established.testnet".parse().unwrap(),
        Reputation { alpha: 2, beta: 2 },
    );
    close_round(&mut contract);
    assert_eq!(winner(&contract), Some("established.testnet".to_string()));
}
