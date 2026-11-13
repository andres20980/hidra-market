// test_late_actions_after_close.rs v1.0
// Adversarial: once close_round has run (state Closed) the bidding phase is
// sealed. A late commit, a late reveal of a committed bid, and a second
// close_round must all be rejected by the state guard, and the task must be
// unchanged (no bids smuggled in, winner untouched). Pin neard.
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::{Data, Reference};
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

async fn expect_rejected(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    who: &Account,
    method: &str,
    args: Value,
    reason: &str,
) -> testresult::TestResult<()> {
    let outcome = contract
        .call_function(method, args)
        .transaction()
        .with_signer(who.account_id().clone(), signer.clone())
        .send_to(network)
        .await;
    let msg = match outcome {
        Ok(result) => match result.into_result() {
            Ok(_) => return Err(format!("{method} after close was accepted").into()),
            Err(failure) => format!("{failure:?}"),
        },
        Err(err) => format!("{err:?}"),
    };
    assert!(msg.contains(reason), "{method}: unexpected failure: {msg}");
    Ok(())
}

#[tokio::test]
async fn test_late_actions_after_close_are_rejected() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let early = create_subaccount(&sandbox, "early.sandbox").await?;
    let lazy = create_subaccount(&sandbox, "lazy.sandbox").await?;
    let late = create_subaccount(&sandbox, "late.sandbox").await?;
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

    contract
        .call_function(
            "post_task",
            json!({
                "id": "sealed",
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

    for w in [&early, &lazy, &late] {
        contract
            .call_function("register_worker", json!({}))
            .transaction()
            .with_signer(w.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }

    // early and lazy commit in time; only early reveals.
    for w in [&early, &lazy] {
        let c = commitment(500, 7, w.account_id().as_str());
        contract
            .call_function("commit_bid", json!({"task_id": "sealed", "commitment": c}))
            .transaction()
            .with_signer(w.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({"task_id": "sealed", "price": 500, "salt": 7}),
        )
        .transaction()
        .with_signer(early.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "sealed"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let before = get_task(&contract, &network, "sealed").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(before.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Closed);
    assert_eq!(before["winner"], json!(early.account_id()));

    // 1) Late commit by a registered worker that never bid.
    let c = commitment(1, 1, late.account_id().as_str());
    expect_rejected(
        &contract,
        &network,
        &signer,
        &late,
        "commit_bid",
        json!({"task_id": "sealed", "commitment": c}),
        "Task is not open",
    )
    .await?;
    // 2) Late reveal of a valid, previously committed (cheaper) bid.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &lazy,
        "reveal_bid",
        json!({"task_id": "sealed", "price": 500, "salt": 7}),
        "Task is not open",
    )
    .await?;
    // 3) Second close_round (winner re-selection attempt).
    expect_rejected(
        &contract,
        &network,
        &signer,
        &late,
        "close_round",
        json!({"task_id": "sealed"}),
        "Task is not open",
    )
    .await?;

    let after = get_task(&contract, &network, "sealed").await?;
    assert_eq!(after["state"], before["state"]);
    assert_eq!(after["winner"], before["winner"]);
    assert_eq!(after["bids"], before["bids"]);
    assert_eq!(after["bids"].as_array().map(|b| b.len()), Some(1));

    Ok(())
}
