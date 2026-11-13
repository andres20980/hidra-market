// test_cap.rs v1.1
// Pin the neard ledger version so a clean clone fetches the exact same binary
// (reproducibility: do not rely on the crate's implicit default).
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::Data;
use near_api::{Account, Contract, NetworkConfig, Signer, Tokens};
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

async fn contract_balance(
    contract: &Contract,
    network: &NetworkConfig,
) -> testresult::TestResult<NearToken> {
    Ok(Tokens::account(contract.account_id().clone())
        .near_balance()
        .fetch_from(network)
        .await?
        .total)
}

#[tokio::test]
async fn test_spending_cap_forces_on_chain_refund() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let worker = create_subaccount(&sandbox, "worker.sandbox").await?;
    let contract = create_subaccount(&sandbox, "market.sandbox")
        .await?
        .as_contract();

    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    let wasm_path = format!("{target_dir}/wasm32-unknown-unknown/release/contract.wasm");
    Contract::deploy(contract.account_id().clone())
        .use_code(std::fs::read(wasm_path)?)
        .with_init_call("init", json!({"cap_per_agent": 500_u128}))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Escrow held by the contract before the task is posted.
    let escrow_before = contract_balance(&contract, &network).await?;

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

    contract
        .call_function("register_worker", json!({}))
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let mut payload = Vec::new();
    payload.extend_from_slice(&100_u64.to_be_bytes());
    payload.extend_from_slice(&1_u32.to_be_bytes());
    payload.extend_from_slice(worker.account_id().as_str().as_bytes());
    let commitment = Sha256::digest(payload).to_vec();
    contract
        .call_function(
            "commit_bid",
            json!({ "task_id": "round-1", "commitment": commitment }),
        )
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({ "task_id": "round-1", "price": 100, "salt": 1 }),
        )
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "round-1"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let round: Data<Option<Value>> = contract
        .call_function("get_round", json!({ "task_id": "round-1" }))
        .read_only()
        .fetch_from(&network)
        .await?;
    assert_eq!(
        round.data.and_then(|r| r.get("winner").cloned()),
        Some(json!(worker.account_id().as_str()))
    );

    contract
        .call_function(
            "submit_result",
            json!({ "task_id": "round-1", "result_hash": "sha256:result" }),
        )
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Reward (1_000 yocto) exceeds the remaining cap (500) => refund, no pay.
    contract
        .call_function("attest", json!({ "task_id": "round-1", "ok": true }))
        .transaction()
        .with_signer(verifier.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    assert_eq!(
        task_state(&contract, &network, "round-1").await?,
        TaskState::Refunded
    );

    // No payment => no spend, reputation untouched (prior Beta(1,1)).
    let rep: Data<(String, String, String)> = contract
        .call_function("get_reputation", json!({ "account": worker.account_id() }))
        .read_only()
        .fetch_from(&network)
        .await?;
    assert_eq!(rep.data, ("1".to_string(), "1".to_string(), "0.5".to_string()));

    // The escrow went back to the publisher: contract balance is back to baseline.
    assert_eq!(
        contract_balance(&contract, &network).await?,
        escrow_before
    );

    Ok(())
}
