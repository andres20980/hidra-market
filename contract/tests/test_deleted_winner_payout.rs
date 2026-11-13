// test_deleted_winner_payout.rs v1.0
// Adversarial: the winner deletes its account after submit_result and before
// attest. attest(ok) pays with a detached Transfer to a now-nonexistent
// account. The tx must not panic, the task must reach Settled exactly once,
// and the failed transfer's deposit must bounce back to the contract (no
// yocto lost, none minted). Documents where the reward ends up. Pin neard.
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
async fn test_deleted_winner_payout_bounces_to_contract() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let ghost = create_subaccount(&sandbox, "ghost.sandbox").await?;
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
                "id": "orphan",
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
        .with_signer(ghost.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let c = commitment(500, 9, ghost.account_id().as_str());
    contract
        .call_function("commit_bid", json!({"task_id": "orphan", "commitment": c}))
        .transaction()
        .with_signer(ghost.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({"task_id": "orphan", "price": 500, "salt": 9}),
        )
        .transaction()
        .with_signer(ghost.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "orphan"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    contract
        .call_function(
            "submit_result",
            json!({"task_id": "orphan", "result_hash": "rh"}),
        )
        .transaction()
        .with_signer(ghost.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Winner vanishes before being paid.
    ghost
        .delete_account_with_beneficiary(publisher.account_id().clone())
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let gone = Tokens::account(ghost.account_id().clone())
        .near_balance()
        .fetch_from(&network)
        .await;
    assert!(gone.is_err(), "winner account should no longer exist");

    let before_attest = contract_balance(&contract, &network).await?;
    let outcome = contract
        .call_function("attest", json!({"task_id": "orphan", "ok": true}))
        .transaction()
        .with_signer(verifier.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?;
    // The attest receipt itself succeeds; only the detached transfer fails.
    let near_api::types::transaction::result::TransactionResult::Full(full) = outcome else {
        return Err("attest still pending".into());
    };
    let receipt_failures = full.receipt_failures().len();
    assert!(full.is_success(), "attest must not revert: {full:?}");
    assert_eq!(receipt_failures, 1, "exactly the payout transfer fails");

    let task = get_task(&contract, &network, "orphan").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(task.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Settled);

    // The bounced deposit returns to the contract: the reward stays there
    // (not lost, not paid twice). Allow only gas-reward noise upwards.
    let after_attest = contract_balance(&contract, &network).await?;
    assert!(
        after_attest >= before_attest,
        "reward leaked: {before_attest} -> {after_attest}"
    );

    // No second payout or refund path for a settled task.
    let again = contract
        .call_function("attest", json!({"task_id": "orphan", "ok": true}))
        .transaction()
        .with_signer(verifier.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?;
    assert!(
        again.into_result().is_err(),
        "second attest must be rejected"
    );
    let refund = contract
        .call_function("refund_expired", json!({"task_id": "orphan"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?;
    assert!(
        refund.into_result().is_err(),
        "refund of a settled task must be rejected"
    );

    Ok(())
}
