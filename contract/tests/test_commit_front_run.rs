// test_commit_front_run.rs v1.0
// Adversarial: commit front-running. A worker who copies another worker's
// public commitment hash gains nothing: the hash binds (price, salt) to the
// committer's account, so the copy can never be revealed, cannot be swapped
// for a fresh commitment, and the honest bid wins the round alone.
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::{Data, Reference};
use near_api::{Account, Contract, NetworkConfig, Signer};
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
            Ok(_) => return Err(format!("{method} was accepted").into()),
            Err(failure) => format!("{failure:?}"),
        },
        Err(err) => format!("{err:?}"),
    };
    assert!(msg.contains(reason), "{method}: unexpected failure: {msg}");
    Ok(())
}

#[tokio::test]
async fn test_copied_commitment_cannot_front_run() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let honest = create_subaccount(&sandbox, "honest.sandbox").await?;
    let sniper = create_subaccount(&sandbox, "sniper.sandbox").await?;
    let stranger = create_subaccount(&sandbox, "stranger.sandbox").await?;
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
                "id": "race",
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

    for w in [&honest, &sniper] {
        contract
            .call_function("register_worker", json!({}))
            .transaction()
            .with_signer(w.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }

    let honest_hash = commitment(500, 7, honest.account_id().as_str());
    contract
        .call_function(
            "commit_bid",
            json!({"task_id": "race", "commitment": honest_hash}),
        )
        .transaction()
        .with_signer(honest.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // The sniper reads the public commitment from the view and copies it verbatim.
    let open = get_task(&contract, &network, "race").await?;
    let leaked: Vec<u8> = near_sdk::serde_json::from_value(open["commitments"][0]["hash"].clone())?;
    assert_eq!(leaked, honest_hash, "view exposes the hash, not the price");

    // 1) Unregistered account cannot even copy the commitment.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &stranger,
        "commit_bid",
        json!({"task_id": "race", "commitment": leaked}),
        "Worker is not registered",
    )
    .await?;
    // 2) Malformed (truncated) hash is rejected.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &sniper,
        "commit_bid",
        json!({"task_id": "race", "commitment": leaked[..31].to_vec()}),
        "Commitment must be a SHA-256 hash",
    )
    .await?;

    // 3) Registered sniper commits the identical hash: accepted, but useless.
    contract
        .call_function(
            "commit_bid",
            json!({"task_id": "race", "commitment": leaked}),
        )
        .transaction()
        .with_signer(sniper.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    // 4) Sniper cannot swap the copy for a fresh commitment once it learns more.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &sniper,
        "commit_bid",
        json!({"task_id": "race", "commitment": commitment(499, 1, sniper.account_id().as_str())}),
        "Worker already committed",
    )
    .await?;

    sandbox.fast_forward(100).await?;

    // Honest reveals first, publishing (500, 7) on chain.
    contract
        .call_function(
            "reveal_bid",
            json!({"task_id": "race", "price": 500, "salt": 7}),
        )
        .transaction()
        .with_signer(honest.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // 5) Even knowing the preimage, the sniper cannot open the copied hash:
    // sha256(price || salt || account) binds it to honest's account.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &sniper,
        "reveal_bid",
        json!({"task_id": "race", "price": 500, "salt": 7}),
        "Reveal does not match commitment",
    )
    .await?;
    // 6) Nor undercut with any other price.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &sniper,
        "reveal_bid",
        json!({"task_id": "race", "price": 499, "salt": 7}),
        "Reveal does not match commitment",
    )
    .await?;

    let mid = get_task(&contract, &network, "race").await?;
    let bids = mid["bids"].as_array().ok_or("no bids")?;
    assert_eq!(bids.len(), 1, "only the honest bid counts: {bids:?}");
    assert_eq!(bids[0]["worker"], json!(honest.account_id()));

    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "race"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let closed = get_task(&contract, &network, "race").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(closed.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Closed);
    assert_eq!(closed["winner"], json!(honest.account_id()));
    Ok(())
}
