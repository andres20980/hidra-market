// test_no_bids_refund.rs v1.0
// Adversarial: a task that receives NO bids must not trap the publisher's
// escrow. close_round on an empty round picks no winner; refund_expired then
// returns the full escrow to the publisher. Pin neard for reproducibility.
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::{Data, Reference};
use near_api::{Account, Contract, NetworkConfig, Signer, Tokens};
use near_sdk::NearToken;
use near_sdk::serde_json::{Value, json};

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
async fn test_no_bids_round_refunds_publisher() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
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
    let balance_before = contract_balance(&contract, &network).await?;
    contract
        .call_function(
            "post_task",
            json!({
                "id": "empty-round",
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

    // Escrow is now held by the contract.
    let balance_escrowed = contract_balance(&contract, &network).await?;
    assert_eq!(balance_escrowed, balance_before + reward);

    // Nobody commits or reveals. Fast-forward past both windows and close.
    sandbox.fast_forward(200).await?;
    contract
        .call_function("close_round", json!({"task_id": "empty-round"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let task = get_task(&contract, &network, "empty-round").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(task.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Closed);
    // Empty round => no winner selected.
    assert!(task.get("winner").map(|w| w.is_null()).unwrap_or(true));
    assert_eq!(
        task.get("bids").and_then(|b| b.as_array()).map(|b| b.len()),
        Some(0)
    );

    // Grace must elapse before the escrow can be reclaimed.
    sandbox.fast_forward(101).await?;
    contract
        .call_function("refund_expired", json!({"task_id": "empty-round"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let task = get_task(&contract, &network, "empty-round").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(task.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Refunded);

    // Money invariant: the escrow left the contract (returned to publisher).
    let balance_after = contract_balance(&contract, &network).await?;
    assert_eq!(balance_after, balance_before);

    Ok(())
}
