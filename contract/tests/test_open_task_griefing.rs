// test_open_task_griefing.rs v1.0
// Adversarial: many minimum-deposit open tasks consume storage backed by shared escrow.
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
async fn minimum_deposit_open_task_spam_cannot_freeze_honest_escrow() -> testresult::TestResult<()>
{
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
    sandbox
        .create_account(market_id.clone())
        .initial_balance(NearToken::from_near(3))
        .send()
        .await?;
    let contract = Contract("market.sandbox".parse()?);
    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    Contract::deploy(contract.account_id().clone())
        .use_code(std::fs::read(format!(
            "{target_dir}/wasm32-unknown-unknown/release/contract.wasm"
        ))?)
        .with_init_call("init", json!({"cap_per_agent": 10_000_u128}))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let reward = 10_000_000_000_000_000_000_000_u128;
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
    for n in 0..100 {
        let id = format!("spam-{n:03}{}", "x".repeat(56));
        match call(
            &contract,
            &network,
            &signer,
            &attacker,
            "post_task",
            json!({"id": id, "verifier": attacker.account_id(), "commit_len": 10, "reveal_len": 10}),
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
    println!("open-task spam accepted={posted}; last rejection={rejected:?}");
    assert!(
        settlement.is_ok(),
        "open-task spam froze honest escrow after {posted} tasks; spam rejection={rejected:?}: {}",
        settlement.unwrap_err()
    );
    Ok(())
}
