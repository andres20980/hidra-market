// test_early_refund.rs v1.0
// Adversarial: refund_expired must not let anyone pull the escrow early.
// It is rejected while the round is Open and during the grace period after
// close (winner still has time to deliver). After the grace period anyone may
// trigger it, but the escrow goes ONLY to the publisher (caller gets nothing),
// the silent winner is penalised once, and a second refund is rejected.
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::{Data, Reference};
use near_api::{Account, Contract, NetworkConfig, Signer, Tokens};
use near_sdk::serde_json::{json, Value};
use near_sdk::NearToken;
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

fn task_state(task: &Value) -> testresult::TestResult<TaskState> {
    Ok(near_sdk::serde_json::from_value(
        task.get("state").cloned().ok_or("no state")?,
    )?)
}

async fn balance(account: &Account, network: &NetworkConfig) -> testresult::TestResult<u128> {
    Ok(Tokens::account(account.account_id().clone())
        .near_balance()
        .fetch_from(network)
        .await?
        .total
        .as_yoctonear())
}

async fn reputation(
    contract: &Contract,
    network: &NetworkConfig,
    who: &Account,
) -> testresult::TestResult<(String, String)> {
    let rep: Data<(String, String, String)> = contract
        .call_function("get_reputation", json!({ "account": who.account_id() }))
        .read_only()
        .at(Reference::Final)
        .fetch_from(network)
        .await?;
    Ok((rep.data.0, rep.data.1))
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
    reason: &str,
) -> testresult::TestResult<()> {
    let outcome = contract
        .call_function("refund_expired", json!({"task_id": "slow"}))
        .transaction()
        .with_signer(who.account_id().clone(), signer.clone())
        .send_to(network)
        .await;
    let msg = match outcome {
        Ok(result) => match result.into_result() {
            Ok(_) => return Err("early refund_expired was accepted".into()),
            Err(failure) => format!("{failure:?}"),
        },
        Err(err) => format!("{err:?}"),
    };
    assert!(msg.contains(reason), "unexpected failure: {msg}");
    Ok(())
}

#[tokio::test]
async fn test_refund_before_deadline_is_rejected() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let winner = create_subaccount(&sandbox, "winner.sandbox").await?;
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
                "id": "slow",
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
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // 1) Refund while the round is still Open (publisher and worker).
    expect_rejected(
        &contract,
        &network,
        &signer,
        &publisher,
        "Task is not closed",
    )
    .await?;
    expect_rejected(&contract, &network, &signer, &winner, "Task is not closed").await?;

    let c = commitment(500, 9, winner.account_id().as_str());
    contract
        .call_function("commit_bid", json!({"task_id": "slow", "commitment": c}))
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({"task_id": "slow", "price": 500, "salt": 9}),
        )
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "slow"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // 2) Refund inside the grace period: the winner still has time to deliver.
    for who in [&publisher, &winner, &verifier] {
        expect_rejected(
            &contract,
            &network,
            &signer,
            who,
            "Refund grace period has not elapsed",
        )
        .await?;
    }
    let task = get_task(&contract, &network, "slow").await?;
    assert_eq!(task_state(&task)?, TaskState::Closed);
    assert_eq!(task["winner"], json!(winner.account_id()));
    assert_eq!(
        reputation(&contract, &network, &winner).await?,
        ("1".to_string(), "1".to_string())
    );

    // 3) After the grace period a third party (the silent winner itself)
    //    triggers the refund: escrow goes to the publisher only.
    sandbox.fast_forward(101).await?;
    let publisher_before = balance(&publisher, &network).await?;
    contract
        .call_function("refund_expired", json!({"task_id": "slow"}))
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let publisher_after = balance(&publisher, &network).await?;
    assert_eq!(publisher_after, publisher_before + reward);

    let task = get_task(&contract, &network, "slow").await?;
    assert_eq!(task_state(&task)?, TaskState::Refunded);
    assert_eq!(
        reputation(&contract, &network, &winner).await?,
        ("1".to_string(), "2".to_string())
    );

    // 4) No double refund, and the penalty is applied only once.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &publisher,
        "Task is not closed",
    )
    .await?;
    assert_eq!(
        reputation(&contract, &network, &winner).await?,
        ("1".to_string(), "2".to_string())
    );

    Ok(())
}
