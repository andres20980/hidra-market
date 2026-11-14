// test_round_spam.rs v2.1
// Adversarial: many minimum-deposit rounds must not freeze an honest payout.
// FIXED: post_task now enforces a storage reserve (own funds >= staked storage
// + reserve), so spam rounds are rejected before they can freeze open escrows.
const SANDBOX_VERSION: &str = "2.14.0";
use near_api::{Account, Contract, NetworkConfig, Signer};
use near_sdk::serde_json::json;
use near_sdk::NearToken;
use sha2::{Digest, Sha256};

async fn create_account(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<Account> {
    let id: near_sdk::AccountId = name.parse()?;
    sandbox
        .create_account(id)
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(Account(name.parse()?))
}

async fn call(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    who: &Account,
    method: &str,
    args: near_sdk::serde_json::Value,
    deposit: u128,
) -> testresult::TestResult<Result<(), String>> {
    let outcome = contract
        .call_function(method, args)
        .transaction()
        .deposit(NearToken::from_yoctonear(deposit))
        .with_signer(who.account_id().clone(), signer.clone())
        .send_to(network)
        .await?;
    Ok(match outcome.into_result() {
        Ok(_) => Ok(()),
        Err(failure) => Err(format!("{failure:?}")),
    })
}

fn commitment(price: u64, salt: u32, worker: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&price.to_be_bytes());
    payload.extend_from_slice(&salt.to_be_bytes());
    payload.extend_from_slice(worker.as_bytes());
    Sha256::digest(payload).to_vec()
}

#[tokio::test]
async fn distinct_minimum_deposit_rounds_cannot_freeze_honest_payout() -> testresult::TestResult<()>
{
    const SPAM_ROUNDS: u32 = 250;
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    let publisher = create_account(&sandbox, "publisher.sandbox").await?;
    let verifier = create_account(&sandbox, "verifier.sandbox").await?;
    let worker = create_account(&sandbox, "worker.sandbox").await?;
    let attacker = create_account(&sandbox, "attacker.sandbox").await?;
    let market_id: near_sdk::AccountId = "market.sandbox".parse()?;
    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    let wasm = std::fs::read(format!(
        "{target_dir}/wasm32-unknown-unknown/release/contract.wasm"
    ))?;
    // Fund only the code's storage stake plus FREE_AFTER_CODE, so the guard
    // trips after tens of spam rounds instead of ~235 (keeps `make verify` fast).
    const FREE_AFTER_CODE: u128 = 250_000_000_000_000_000_000_000; // 0.25 NEAR
    let byte_cost = 10_000_000_000_000_000_000_u128;
    sandbox
        .create_account(market_id.clone())
        .initial_balance(NearToken::from_yoctonear(
            wasm.len() as u128 * byte_cost + FREE_AFTER_CODE,
        ))
        .send()
        .await?;
    let contract = Contract("market.sandbox".parse()?);
    Contract::deploy(contract.account_id().clone())
        .use_code(wasm)
        .with_init_call("init", json!({"cap_per_agent": 10_000_000_000_000_000_000_u128}))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Honest reward must stay <= cap_per_agent (which must fit a JSON u64), so
    // that attest(ok) settles instead of hitting the per-agent cap and refunding.
    let reward = 1_000_000_000_000_000_000_u128;
    call(
        &contract,
        &network,
        &signer,
        &publisher,
        "post_task",
        json!({"id": "honest", "verifier": verifier.account_id(), "commit_len": 1_000, "reveal_len": 1_000}),
        reward,
    )
    .await??;
    call(
        &contract,
        &network,
        &signer,
        &worker,
        "register_worker",
        json!({}),
        0,
    )
    .await??;
    call(
        &contract,
        &network,
        &signer,
        &worker,
        "commit_bid",
        json!({"task_id": "honest", "commitment": commitment(1, 7, worker.account_id().as_str())}),
        0,
    )
    .await??;
    sandbox.fast_forward(1_000).await?;
    call(
        &contract,
        &network,
        &signer,
        &worker,
        "reveal_bid",
        json!({"task_id": "honest", "price": 1, "salt": 7}),
        0,
    )
    .await??;
    sandbox.fast_forward(1_000).await?;
    call(
        &contract,
        &network,
        &signer,
        &publisher,
        "close_round",
        json!({"task_id": "honest"}),
        0,
    )
    .await??;
    call(
        &contract,
        &network,
        &signer,
        &worker,
        "submit_result",
        json!({"task_id": "honest", "result_hash": "sha256:ok"}),
        0,
    )
    .await??;

    let mut posted = 0;
    let mut rejected = None;
    for n in 0..SPAM_ROUNDS {
        let id = format!("round-{n:03}-{}", "x".repeat(53));
        match call(
            &contract,
            &network,
            &signer,
            &attacker,
            "post_task",
            json!({"id": id, "verifier": attacker.account_id(), "commit_len": 1, "reveal_len": 1}),
            1,
        )
        .await?
        {
            Ok(()) => posted += 1,
            Err(error) => {
                rejected = Some(error);
                break;
            }
        }
    }

    sandbox.fast_forward(2).await?;
    let mut closed = 0;
    let mut close_rejected = None;
    for n in 0..posted {
        let id = format!("round-{n:03}-{}", "x".repeat(53));
        match call(
            &contract,
            &network,
            &signer,
            &attacker,
            "close_round",
            json!({"task_id": id}),
            0,
        )
        .await?
        {
            Ok(()) => closed += 1,
            Err(error) => {
                close_rejected = Some(error);
                break;
            }
        }
    }

    let settlement = call(
        &contract,
        &network,
        &signer,
        &verifier,
        "attest",
        json!({"task_id": "honest", "ok": true}),
        0,
    )
    .await?;
    assert!(
        (10..SPAM_ROUNDS).contains(&posted)
            && rejected
                .as_deref()
                .is_some_and(|error| error.contains("Storage reserve exhausted")),
        "expected the storage-reserve guard to reject spam before {SPAM_ROUNDS} tasks, got {posted}: {rejected:?}"
    );
    assert_eq!(
        closed, posted,
        "all stored spam rounds must still close: {close_rejected:?}"
    );
    settlement.expect("honest escrow must settle despite the spam");

    let honest: near_api::types::Data<Option<near_sdk::serde_json::Value>> = contract
        .call_function("get_task", json!({"task_id": "honest"}))
        .read_only()
        .fetch_from(&network)
        .await?;
    let honest = honest.data.expect("honest task should exist");
    assert_eq!(
        honest["state"],
        json!("Settled"),
        "honest task must reach Settled, got {honest:?}"
    );
    println!(
        "distinct round spam: posted={posted}/{SPAM_ROUNDS}, closed={closed}, rejected=Storage reserve exhausted, honest attest=Settled"
    );
    Ok(())
}
