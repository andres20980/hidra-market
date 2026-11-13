// test_attest_impostor.rs v1.0
// Adversarial: only the task's verifier may attest. With a winner who has
// submitted a result, attest by the winner itself (self-approval), by the
// publisher, by an outsider (ok=false, trying to slash the winner) and by the
// market contract account must all be rejected; attest by the real verifier
// before submit_result is rejected too. Escrow, state and the winner's Beta
// reputation must be untouched until the real verifier attests. Pin neard.
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
            Ok(_) => return Err(format!("{method} by impostor was accepted").into()),
            Err(failure) => format!("{failure:?}"),
        },
        Err(err) => format!("{err:?}"),
    };
    assert!(msg.contains(reason), "{method}: unexpected failure: {msg}");
    Ok(())
}

async fn reputation(
    contract: &Contract,
    network: &NetworkConfig,
    who: &Account,
) -> testresult::TestResult<(String, String, String)> {
    let raw: Data<(String, String, String)> = contract
        .call_function("get_reputation", json!({ "account": who.account_id() }))
        .read_only()
        .at(Reference::Final)
        .fetch_from(network)
        .await?;
    Ok(raw.data)
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
async fn test_attest_by_non_verifier_is_rejected() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let winner = create_subaccount(&sandbox, "winner.sandbox").await?;
    let outsider = create_subaccount(&sandbox, "outsider.sandbox").await?;
    let market = create_subaccount(&sandbox, "market.sandbox").await?;
    let contract = market.clone().as_contract();

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
                "id": "job",
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
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let c = commitment(400, 9, winner.account_id().as_str());
    contract
        .call_function("commit_bid", json!({"task_id": "job", "commitment": c}))
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({"task_id": "job", "price": 400, "salt": 9}),
        )
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({"task_id": "job"}))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Real verifier cannot approve before a result exists.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &verifier,
        "attest",
        json!({"task_id": "job", "ok": true}),
        "Result has not been submitted",
    )
    .await?;

    contract
        .call_function(
            "submit_result",
            json!({"task_id": "job", "result_hash": "sha256:feed"}),
        )
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let before = get_task(&contract, &network, "job").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(before.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Closed);
    assert_eq!(before["winner"], json!(winner.account_id()));
    let rep_before = reputation(&contract, &network, &winner).await?;
    assert_eq!((rep_before.0.as_str(), rep_before.1.as_str()), ("1", "1"));
    // The market account signing for itself pays its own gas, so probe it
    // before snapshotting the contract balance.
    expect_rejected(
        &contract,
        &network,
        &signer,
        &market,
        "attest",
        json!({"task_id": "job", "ok": true}),
        "Only the verifier can attest",
    )
    .await?;
    let balance_before = contract_balance(&contract, &network).await?;

    // Impostors: self-approval, publisher, outsider trying to slash.
    for (who, ok) in [(&winner, true), (&publisher, true), (&outsider, false)] {
        expect_rejected(
            &contract,
            &network,
            &signer,
            who,
            "attest",
            json!({"task_id": "job", "ok": ok}),
            "Only the verifier can attest",
        )
        .await?;
    }

    let after = get_task(&contract, &network, "job").await?;
    assert_eq!(after["state"], before["state"]);
    assert_eq!(after["winner"], before["winner"]);
    assert_eq!(after["result_hash"], before["result_hash"]);
    assert_eq!(reputation(&contract, &network, &winner).await?, rep_before);
    let balance_after = contract_balance(&contract, &network).await?;
    assert!(
        balance_after >= balance_before,
        "escrow leaked: {balance_before} -> {balance_after}"
    );

    // The real verifier still settles normally afterwards.
    contract
        .call_function("attest", json!({"task_id": "job", "ok": true}))
        .transaction()
        .with_signer(verifier.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let settled = get_task(&contract, &network, "job").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(settled.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Settled);
    let rep_after = reputation(&contract, &network, &winner).await?;
    assert_eq!((rep_after.0.as_str(), rep_after.1.as_str()), ("2", "1"));

    Ok(())
}
