// test_rules.rs v1.0
use near_api::types::Data;
use near_api::{Account, Contract, NetworkConfig, Signer};
use near_sdk::NearToken;
use near_sdk::serde_json::{Value, json};
use sha2::{Digest, Sha256};

async fn create_subaccount(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<Account> {
    let account_id: near_sdk::AccountId = name.parse()?;
    sandbox
        .create_account(account_id)
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(Account(name.parse()?))
}

#[tokio::test]
async fn test_full_round_with_three_workers() -> testresult::TestResult<()> {
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
    let workers = vec![
        create_subaccount(&sandbox, "worker-0.sandbox").await?,
        create_subaccount(&sandbox, "worker-1.sandbox").await?,
        create_subaccount(&sandbox, "worker-2.sandbox").await?,
    ];

    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    let wasm_path = format!(
        "{}/wasm32-unknown-unknown/release/contract.wasm",
        target_dir
    );
    Contract::deploy(contract.account_id().clone())
        .use_code(std::fs::read(&wasm_path)?)
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

    let bids = [(100_u64, 11_u32), (200, 22), (300, 33)];
    for worker in &workers {
        contract
            .call_function("register_worker", json!({}))
            .transaction()
            .with_signer(worker.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }

    for (worker, (price, salt)) in workers.iter().zip(bids) {
        let mut payload = Vec::new();
        payload.extend_from_slice(&price.to_be_bytes());
        payload.extend_from_slice(&salt.to_be_bytes());
        payload.extend_from_slice(worker.account_id().as_str().as_bytes());
        let commitment = Sha256::digest(payload).to_vec();
        contract
            .call_function(
                "commit_bid",
                json!({"task_id": "round-1", "commitment": commitment}),
            )
            .transaction()
            .with_signer(worker.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }

    sandbox.fast_forward(100).await?;
    for (worker, (price, salt)) in workers.iter().zip(bids) {
        contract
            .call_function(
                "reveal_bid",
                json!({"task_id": "round-1", "price": price, "salt": salt}),
            )
            .transaction()
            .with_signer(worker.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "round-1"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    contract
        .call_function(
            "submit_result",
            json!({"task_id": "round-1", "result_hash": "sha256:verified-result"}),
        )
        .transaction()
        .with_signer(workers[0].account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    contract
        .call_function("attest", json!({"task_id": "round-1", "ok": true}))
        .transaction()
        .with_signer(verifier.account_id().clone(), signer)
        .send_to(&network)
        .await?
        .assert_success();

    let task: Data<Option<Value>> = contract
        .call_function("get_task", json!({"task_id": "round-1"}))
        .read_only()
        .fetch_from(&network)
        .await?;
    let task = task.data.expect("round-1 should exist");
    assert_eq!(task["state"], json!("Settled"));
    assert_eq!(task["winner"], json!(workers[0].account_id().as_str()));
    assert_eq!(task["result_hash"], json!("sha256:verified-result"));
    assert_eq!(task["bids"].as_array().map(Vec::len), Some(3));

    Ok(())
}
