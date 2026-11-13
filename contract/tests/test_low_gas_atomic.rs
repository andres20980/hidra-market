// test_low_gas_atomic.rs v1.0
// Adversarial: money functions called with too little prepaid gas must abort
// atomically. attest(ok=true) and refund_expired are sent with 1 Tgas: the
// receipt fails, no Transfer is emitted, state/reputation/spent are unchanged
// and the task can still be settled or refunded normally afterwards (no
// half-applied payout, no stuck escrow). Pin neard.
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::{Data, NearGas, Reference};
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

async fn near_balance(network: &NetworkConfig, who: &Account) -> testresult::TestResult<u128> {
    Ok(Tokens::account(who.account_id().clone())
        .near_balance()
        .fetch_from(network)
        .await?
        .total
        .as_yoctonear())
}

async fn send_low_gas(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    who: &Account,
    method: &str,
    args: Value,
) -> testresult::TestResult<String> {
    let outcome = contract
        .call_function(method, args)
        .transaction()
        .gas(NearGas::from_tgas(1))
        .with_signer(who.account_id().clone(), signer.clone())
        .send_to(network)
        .await;
    let msg = match outcome {
        Ok(result) => match result.into_result() {
            Ok(_) => return Err(format!("{method} with 1 Tgas succeeded").into()),
            Err(failure) => format!("{failure:?}"),
        },
        Err(err) => format!("{err:?}"),
    };
    Ok(msg)
}

fn state_of(task: &Value) -> testresult::TestResult<TaskState> {
    Ok(near_sdk::serde_json::from_value(
        task.get("state").cloned().ok_or("no state")?,
    )?)
}

#[tokio::test]
async fn test_low_gas_money_calls_abort_atomically() -> testresult::TestResult<()> {
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

    for id in ["paid", "empty"] {
        contract
            .call_function(
                "post_task",
                json!({
                    "id": id,
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
    }

    contract
        .call_function("register_worker", json!({}))
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let c = commitment(400, 9, winner.account_id().as_str());
    contract
        .call_function("commit_bid", json!({"task_id": "paid", "commitment": c}))
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({"task_id": "paid", "price": 400, "salt": 9}),
        )
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    for id in ["paid", "empty"] {
        contract
            .call_function("close_round", json!({"task_id": id}))
            .transaction()
            .with_signer(publisher.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    contract
        .call_function(
            "submit_result",
            json!({"task_id": "paid", "result_hash": "sha256:feed"}),
        )
        .transaction()
        .with_signer(winner.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // 1) attest(ok=true) starved of gas: nothing moves.
    let before = get_task(&contract, &network, "paid").await?;
    assert_eq!(state_of(&before)?, TaskState::Closed);
    let rep_before = reputation(&contract, &network, &winner).await?;
    let winner_before = near_balance(&network, &winner).await?;
    let market_before = contract_balance(&contract, &network).await?;
    let msg = send_low_gas(
        &contract,
        &network,
        &signer,
        &verifier,
        "attest",
        json!({"task_id": "paid", "ok": true}),
    )
    .await?;
    assert!(
        msg.contains("Exceeded the prepaid gas") || msg.contains("GasExceeded"),
        "attest: unexpected failure: {msg}"
    );
    let after = get_task(&contract, &network, "paid").await?;
    assert_eq!(after, before, "attest half-applied");
    assert_eq!(reputation(&contract, &network, &winner).await?, rep_before);
    assert_eq!(near_balance(&network, &winner).await?, winner_before);
    assert!(contract_balance(&contract, &network).await? >= market_before);

    // 2) refund_expired starved of gas after the grace period: nothing moves.
    sandbox.fast_forward(101).await?;
    let empty_before = get_task(&contract, &network, "empty").await?;
    assert_eq!(state_of(&empty_before)?, TaskState::Closed);
    let publisher_before = near_balance(&network, &publisher).await?;
    let msg = send_low_gas(
        &contract,
        &network,
        &signer,
        &outsider,
        "refund_expired",
        json!({"task_id": "empty"}),
    )
    .await?;
    assert!(
        msg.contains("Exceeded the prepaid gas") || msg.contains("GasExceeded"),
        "refund_expired: unexpected failure: {msg}"
    );
    assert_eq!(get_task(&contract, &network, "empty").await?, empty_before);
    assert_eq!(near_balance(&network, &publisher).await?, publisher_before);

    // 3) With normal gas both still complete exactly once.
    contract
        .call_function("attest", json!({"task_id": "paid", "ok": true}))
        .transaction()
        .with_signer(verifier.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let settled = get_task(&contract, &network, "paid").await?;
    assert_eq!(state_of(&settled)?, TaskState::Settled);
    let rep_after = reputation(&contract, &network, &winner).await?;
    assert_eq!((rep_after.0.as_str(), rep_after.1.as_str()), ("2", "1"));
    assert_eq!(
        near_balance(&network, &winner).await?,
        winner_before + 1_000
    );

    contract
        .call_function("refund_expired", json!({"task_id": "empty"}))
        .transaction()
        .with_signer(outsider.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let refunded = get_task(&contract, &network, "empty").await?;
    assert_eq!(state_of(&refunded)?, TaskState::Refunded);
    assert_eq!(
        near_balance(&network, &publisher).await?,
        publisher_before + 1_000
    );

    Ok(())
}
