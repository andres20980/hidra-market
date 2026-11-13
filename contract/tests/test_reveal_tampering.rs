// test_reveal_tampering.rs v1.0
// Adversarial: the commit-reveal binding. A reveal with a different price or
// salt, a replay of another worker's (price, salt), a reveal without commit,
// a reveal inside the commit window and a double reveal must all be rejected;
// failed attempts leave the commitment intact and exactly one bid is counted.
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
            Ok(_) => return Err(format!("{method} was accepted").into()),
            Err(failure) => format!("{failure:?}"),
        },
        Err(err) => format!("{err:?}"),
    };
    assert!(msg.contains(reason), "{method}: unexpected failure: {msg}");
    Ok(())
}

#[tokio::test]
async fn test_reveal_tampering_and_double_reveal_are_rejected() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let honest = create_subaccount(&sandbox, "honest.sandbox").await?;
    let copycat = create_subaccount(&sandbox, "copycat.sandbox").await?;
    let outsider = create_subaccount(&sandbox, "outsider.sandbox").await?;
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

    for w in [&honest, &copycat, &outsider] {
        contract
            .call_function("register_worker", json!({}))
            .transaction()
            .with_signer(w.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }

    for (w, price, salt) in [(&honest, 500_u64, 7_u32), (&copycat, 900, 3)] {
        let c = commitment(price, salt, w.account_id().as_str());
        contract
            .call_function("commit_bid", json!({"task_id": "sealed", "commitment": c}))
            .transaction()
            .with_signer(w.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }

    // 0) Early reveal (still inside the commit window) is rejected.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &honest,
        "reveal_bid",
        json!({"task_id": "sealed", "price": 500, "salt": 7}),
        "Reveal window is closed",
    )
    .await?;

    sandbox.fast_forward(100).await?;

    let reveal = |price: u64, salt: u32| json!({"task_id": "sealed", "price": price, "salt": salt});
    // 1) Lower price than committed (undercut after seeing the field).
    expect_rejected(
        &contract,
        &network,
        &signer,
        &honest,
        "reveal_bid",
        reveal(400, 7),
        "Reveal does not match commitment",
    )
    .await?;
    // 2) Right price, wrong salt.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &honest,
        "reveal_bid",
        reveal(500, 8),
        "Reveal does not match commitment",
    )
    .await?;
    // 3) Overflow-edge price never committed.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &honest,
        "reveal_bid",
        reveal(u64::MAX, 7),
        "Reveal does not match commitment",
    )
    .await?;
    // 4) Copycat replays honest's (price, salt): commitment is bound to the account.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &copycat,
        "reveal_bid",
        reveal(500, 7),
        "Reveal does not match commitment",
    )
    .await?;
    // 5) Outsider without any commitment.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &outsider,
        "reveal_bid",
        reveal(500, 7),
        "No commitment for worker",
    )
    .await?;

    // Failed attempts are reverted: no bid smuggled in, both commitments intact.
    let mid = get_task(&contract, &network, "sealed").await?;
    assert_eq!(mid["bids"].as_array().ok_or("no bids")?.len(), 0);
    assert_eq!(
        mid["commitments"].as_array().ok_or("no commitments")?.len(),
        2
    );

    // Honest reveal still succeeds after the failed tampering attempts.
    contract
        .call_function("reveal_bid", reveal(500, 7))
        .transaction()
        .with_signer(honest.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // 6) Double reveal: identical args, then a different price.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &honest,
        "reveal_bid",
        reveal(500, 7),
        "No commitment for worker",
    )
    .await?;
    expect_rejected(
        &contract,
        &network,
        &signer,
        &honest,
        "reveal_bid",
        reveal(100, 7),
        "No commitment for worker",
    )
    .await?;

    let after = get_task(&contract, &network, "sealed").await?;
    let bids = after["bids"].as_array().ok_or("no bids")?;
    assert_eq!(
        bids.len(),
        1,
        "exactly one bid after double reveal: {bids:?}"
    );
    assert_eq!(bids[0]["worker"], json!(honest.account_id()));
    assert_eq!(bids[0]["price"], json!(500));
    assert_eq!(
        after["commitments"]
            .as_array()
            .ok_or("no commitments")?
            .len(),
        1
    );

    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "sealed"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let closed = get_task(&contract, &network, "sealed").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(closed.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Closed);
    assert_eq!(closed["winner"], json!(honest.account_id()));
    Ok(())
}
