// test_deleted_publisher_refund.rs v1.0
// Adversarial: the publisher deletes its account after close_round and the
// winner never submits. refund_expired (callable by anyone) pays the escrow
// back with a detached Transfer to a nonexistent account. The tx must not
// revert, the task must reach Refunded exactly once, the silent winner is
// still penalised, the bounced deposit stays in the contract, and the
// storage-reserve guard keeps admitting honest posts. Pin neard.
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::{Data, Reference};
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

async fn get_task(
    contract: &Contract,
    network: &NetworkConfig,
    task_id: &str,
) -> testresult::TestResult<Value> {
    // Chain-head reads can transiently miss a just-applied tx (optimistic
    // finality races the view). Retry a bounded number of times.
    for _ in 0..20 {
        let raw: Data<Option<Value>> = contract
            .call_function("get_task", json!({ "task_id": task_id }))
            .read_only()
            .at(Reference::Final)
            .fetch_from(network)
            .await?;
        if let Some(task) = raw.data {
            return Ok(task);
        }
    }
    Err("task not found".into())
}

fn commitment(price: u64, salt: u32, worker: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&price.to_be_bytes());
    payload.extend_from_slice(&salt.to_be_bytes());
    payload.extend_from_slice(worker.as_bytes());
    Sha256::digest(payload).to_vec()
}

async fn contract_balance(
    contract: &Contract,
    network: &NetworkConfig,
) -> testresult::TestResult<u128> {
    Ok(Tokens::account(contract.account_id().clone())
        .near_balance()
        .fetch_from(network)
        .await?
        .total
        .as_yoctonear())
}

#[tokio::test]
async fn test_deleted_publisher_refund_bounces_to_contract() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let worker = create_subaccount(&sandbox, "worker.sandbox").await?;
    let bystander = create_subaccount(&sandbox, "bystander.sandbox").await?;
    let contract = create_subaccount(&sandbox, "market.sandbox")
        .await?
        .as_contract();

    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    let wasm_path = format!("{target_dir}/wasm32-unknown-unknown/release/contract.wasm");
    Contract::deploy(contract.account_id().clone())
        .use_code(std::fs::read(wasm_path)?)
        .with_init_call("init", json!({"cap_per_agent": 10_000_u128}))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let reward: u128 = 1_000;
    contract
        .call_function(
            "post_task",
            json!({
                "id": "abandoned",
                "verifier": verifier.account_id(),
                "commit_len": 100,
                "reveal_len": 100,
            }),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(reward))
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
    let c = commitment(500, 7, worker.account_id().as_str());
    contract
        .call_function("commit_bid", json!({"task_id": "abandoned", "commitment": c}))
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({"task_id": "abandoned", "price": 500, "salt": 7}),
        )
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "abandoned"}))
        .transaction()
        .with_signer(bystander.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Publisher vanishes; the winner never submits.
    publisher
        .delete_account_with_beneficiary(bystander.account_id().clone())
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let gone = Tokens::account(publisher.account_id().clone())
        .near_balance()
        .fetch_from(&network)
        .await;
    assert!(gone.is_err(), "publisher account should no longer exist");

    sandbox.fast_forward(110).await?;
    let before_refund = contract_balance(&contract, &network).await?;
    // Anyone may trigger the refund; it must not revert on a dead payee.
    let outcome = contract
        .call_function("refund_expired", json!({"task_id": "abandoned"}))
        .transaction()
        .with_signer(bystander.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?;
    let near_api::types::transaction::result::TransactionResult::Full(full) = outcome else {
        return Err("refund still pending".into());
    };
    let receipt_failures = full.receipt_failures().len();
    assert!(full.is_success(), "refund_expired must not revert: {full:?}");
    assert_eq!(receipt_failures, 1, "exactly the refund transfer fails");

    let task = get_task(&contract, &network, "abandoned").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(task.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Refunded);

    let after_refund = contract_balance(&contract, &network).await?;
    assert!(
        after_refund >= before_refund,
        "escrow leaked: {before_refund} -> {after_refund}"
    );

    // The silent winner is still penalised even though the refund bounced.
    let rep: Data<(String, String, String)> = contract
        .call_function("get_reputation", json!({"account": worker.account_id()}))
        .read_only()
        .at(Reference::Final)
        .fetch_from(&network)
        .await?;
    assert_eq!(rep.data.1, "2", "silent winner beta must be 2: {:?}", rep.data);

    let again = contract
        .call_function("refund_expired", json!({"task_id": "abandoned"}))
        .transaction()
        .with_signer(bystander.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?;
    assert!(again.into_result().is_err(), "second refund must be rejected");

    // Bounced yocto only adds free balance: the escrow guard still admits
    // an honest new task.
    contract
        .call_function(
            "post_task",
            json!({
                "id": "after",
                "verifier": verifier.account_id(),
                "commit_len": 10,
                "reveal_len": 10,
            }),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(reward))
        .with_signer(bystander.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    Ok(())
}
