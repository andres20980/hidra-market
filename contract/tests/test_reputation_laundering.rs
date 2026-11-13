// test_reputation_laundering.rs v1.0
// RED TEAM: a worker's Beta reputation is the only thing that makes it look
// expensive to the reverse auction (`close_round` weights price by 1/mean(Beta),
// so a high `beta` from failed attests pushes the adjusted price up and loses
// rounds). The cheapest escape for a single account would be to *launder* that
// history: call `register_worker` again to wipe the accrued `beta` back to the
// Beta(1,1) prior. These green tests pin that this single-account path is CLOSED:
//   1) `register_worker` on an already-registered account is rejected and never
//      touches the `reputations` map, so a worker that earned `beta` from failed
//      work cannot reset it by re-registering;
//   2) the only reputation escape left is a brand-new account (a Sybil), which is
//      the documented design limitation covered by
//      test_collusive_verifier_reputation.rs and test_sybil_two_accounts.rs.
// This is a unit test (VMContextBuilder) so it stays fast and offline.
use contract::{Contract, Reputation};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

const WORKER: &str = "sloppy.testnet";
const VERIFIER: &str = "verifier.testnet";
const PUBLISHER: &str = "publisher.testnet";

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

/// One round where `WORKER` is the lone bidder, wins, submits, and the verifier
/// attests `false`. That records a failure: the worker's `beta` grows by one.
fn fail_round(contract: &mut Contract, round: u64) {
    let base = round * 100 + 1;
    let id = format!("f-{round}");
    let worker: AccountId = WORKER.parse().unwrap();

    set_context(PUBLISHER, base, 1);
    contract.post_task(id.clone(), VERIFIER.parse().unwrap(), 10, 10);

    set_context(WORKER, base + 1, 0);
    contract.commit_bid(id.clone(), bid_commitment(&worker, 7, round as u32));

    set_context(WORKER, base + 11, 0);
    contract.reveal_bid(id.clone(), 7, round as u32);

    set_context(PUBLISHER, base + 21, 0);
    contract.close_round(id.clone());

    set_context(WORKER, base + 22, 0);
    contract.submit_result(id.clone(), "a".repeat(32));

    set_context(VERIFIER, base + 23, 0);
    contract.attest(id, false); // bad work -> beta++
}

#[test]
#[should_panic(expected = "Worker already registered")]
fn reregistration_is_rejected() {
    set_context(PUBLISHER, 1, 0);
    let mut contract = Contract::init(NearToken::from_near(1).as_yoctonear());

    set_context(WORKER, 2, 0);
    contract.register_worker();
    // A second registration from the same account must be rejected: this is the
    // guard that forecloses single-account reputation laundering.
    set_context(WORKER, 3, 0);
    contract.register_worker();
}

#[test]
fn bad_reputation_survives_reregistration_attempt() {
    set_context(PUBLISHER, 1, 0);
    let mut contract = Contract::init(NearToken::from_near(1).as_yoctonear());

    set_context(WORKER, 2, 0);
    contract.register_worker();
    assert_eq!(reputation(&contract, WORKER).beta, 1, "Beta(1,1) prior");

    // Accrue a dirty history: three failed attests push beta to 1 + 3 = 4.
    const FAILS: u64 = 3;
    for round in 1..=FAILS {
        fail_round(&mut contract, round);
    }
    let dirty = reputation(&contract, WORKER);
    assert_eq!(dirty.beta, 1 + FAILS, "each failed attest raises beta by 1");
    assert_eq!(dirty.alpha, 1, "no success ever raised alpha");

    // Try to launder it: re-register. The call panics ("Worker already
    // registered"); the reputation map is left exactly as it was.
    let result = catch_unwind(AssertUnwindSafe(|| {
        set_context(WORKER, 10_000, 0);
        contract.register_worker();
    }));
    assert!(result.is_err(), "re-registration must be rejected");

    let after = reputation(&contract, WORKER);
    assert_eq!(after.beta, dirty.beta, "beta is not reset by re-registration");
    assert_eq!(after.alpha, dirty.alpha, "alpha is not reset either");
}
