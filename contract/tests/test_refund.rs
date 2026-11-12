// test_refund.rs v1.0
use contract::TaskState;
use near_api::types::Data;
use near_api::{Account, Contract, NetworkConfig, Signer};
use near_sdk::NearToken;
use near_sdk::serde_json::{Value, json};
use sha2::{Digest, Sha256};

async fn create_subaccount(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<Account> {
    let sandbox_account_id: near_sdk::AccountId = name.parse()?;
    sandbox
        .create_account(sandbox_account_id)
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(Account(name.parse()?))
}

async fn task_state(
    contract: &Contract,
    network: &NetworkConfig,
    task_id: &str,
) -> testresult::TestResult<TaskState> {
    let raw: Data<Option<Value>> = contract
        .call_function("get_task", json!({ "task_id": task_id }))
        .read_only()
        .fetch_from(network)
        .await?;
    let task = raw.data.ok_or("task not found")?;
    let state = task.get("state").cloned().ok_or("task has no state")?;
    Ok(near_sdk::serde_json::from_value(state)?)
}

#[tokio::test]
async fn _dummy() -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[tokio::test]
async fn test_refund_expired_no_attest() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let contract = create_subaccount(&sandbox, "market.sandbox")
        .await?
        .as_contract();

    let wasm_path = "target/wasm32-unknown-unknown/release/contract.wasm".to_string();
    Contract::deploy(contract.account_id().clone())
        .use_code(std::fs::read(wasm_path)?)
        .with_init_call("init", json!({"cap_per_agent": 10_000_u128}))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    contract
        .call_function(
            "post_task",
            json!({
                "id": "round-1",
                "verifier": verifier.account_id(),
                "commit_len": 100,
                "reveal_len": 100,
            }),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(1_000))
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Register a worker
    let worker = create_subaccount(&sandbox, "worker.sandbox").await?;
    contract
        .call_function("register_worker", json!({}))
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Commit bid
    let mut payload = Vec::new();
    payload.extend_from_slice(&100_u64.to_be_bytes());
    payload.extend_from_slice(&1_u32.to_be_bytes());
    payload.extend_from_slice(worker.account_id().as_str().as_bytes());
    let commitment = Sha256::digest(payload).to_vec();
    contract
        .call_function(
            "commit_bid",
            json!({
                "task_id": "round-1",
                "commitment": commitment,
            }),
        )
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Reveal bid
    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({
                "task_id": "round-1",
                "price": 100,
                "salt": 1,
            }),
        )
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Close round (no attestation)
    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "round-1"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // The round is closed but nobody attested yet
    assert_eq!(
        task_state(&contract, &network, "round-1").await?,
        TaskState::Closed
    );

    // The refund grace period must elapse before the publisher is refunded
    sandbox.fast_forward(101).await?;
    contract
        .call_function("refund_expired", json!({"task_id": "round-1"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    assert_eq!(
        task_state(&contract, &network, "round-1").await?,
        TaskState::Refunded
    );

    Ok(())
}
