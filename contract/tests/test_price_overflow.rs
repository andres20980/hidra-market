// test_price_overflow.rs v1.0
// Adversarial: arithmetic edges. Window lengths of u64::MAX must be rejected
// (checked_add, no wrap-around to a past deadline) and leave no task behind;
// bids at u64::MAX must not overflow the reputation-weighted score in
// close_round (u64 * u64 widened to u128): the cheap bid still wins, and a
// lone u64::MAX bid closes cleanly and settles within the per-agent cap.
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

async fn call(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    who: &Account,
    method: &str,
    args: Value,
    deposit: u128,
) -> testresult::TestResult<()> {
    contract
        .call_function(method, args)
        .transaction()
        .deposit(NearToken::from_yoctonear(deposit))
        .with_signer(who.account_id().clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();
    Ok(())
}

#[tokio::test]
async fn test_overflow_edges_are_safe() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let whale = create_subaccount(&sandbox, "whale.sandbox").await?;
    let cheap = create_subaccount(&sandbox, "cheap.sandbox").await?;
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

    // 1) Window overflow: rejected, deposit refunded by the runtime, no task stored.
    for (commit_len, reveal_len, reason) in [
        (u64::MAX, 100_u64, "Commit window overflow"),
        (100, u64::MAX, "Reveal window overflow"),
    ] {
        let outcome = contract
            .call_function(
                "post_task",
                json!({
                    "id": "wrap",
                    "verifier": verifier.account_id(),
                    "commit_len": commit_len,
                    "reveal_len": reveal_len,
                }),
            )
            .transaction()
            .deposit(NearToken::from_yoctonear(1_000))
            .with_signer(publisher.account_id().clone(), signer.clone())
            .send_to(&network)
            .await;
        let msg = match outcome {
            Ok(result) => match result.into_result() {
                Ok(_) => return Err("overflowing post_task was accepted".into()),
                Err(failure) => format!("{failure:?}"),
            },
            Err(err) => format!("{err:?}"),
        };
        assert!(msg.contains(reason), "unexpected failure: {msg}");
    }
    let wrap: Data<Option<Value>> = contract
        .call_function("get_task", json!({"task_id": "wrap"}))
        .read_only()
        .at(Reference::Final)
        .fetch_from(&network)
        .await?;
    assert!(wrap.data.is_none(), "rejected post_task left a task behind");

    for w in [&whale, &cheap] {
        call(
            &contract,
            &network,
            &signer,
            w,
            "register_worker",
            json!({}),
            0,
        )
        .await?;
    }

    // 2) Mixed round: u64::MAX vs 1. Score math must not overflow; cheap wins.
    // 3) Solo round: a lone u64::MAX bid closes and settles (price is not paid out).
    for (id, bidders) in [
        (
            "mixed",
            vec![(&whale, u64::MAX, 11_u32), (&cheap, 1_u64, 22_u32)],
        ),
        ("solo", vec![(&whale, u64::MAX, 33_u32)]),
    ] {
        call(
            &contract,
            &network,
            &signer,
            &publisher,
            "post_task",
            json!({"id": id, "verifier": verifier.account_id(), "commit_len": 100, "reveal_len": 100}),
            1_000,
        )
        .await?;
        for (w, price, salt) in &bidders {
            let c = commitment(*price, *salt, w.account_id().as_str());
            call(
                &contract,
                &network,
                &signer,
                w,
                "commit_bid",
                json!({"task_id": id, "commitment": c}),
                0,
            )
            .await?;
        }
        sandbox.fast_forward(100).await?;
        for (w, price, salt) in &bidders {
            call(
                &contract,
                &network,
                &signer,
                w,
                "reveal_bid",
                json!({"task_id": id, "price": price, "salt": salt}),
                0,
            )
            .await?;
        }
        sandbox.fast_forward(100).await?;
        call(
            &contract,
            &network,
            &signer,
            &publisher,
            "close_round",
            json!({"task_id": id}),
            0,
        )
        .await?;
        let closed = get_task(&contract, &network, id).await?;
        let state: TaskState =
            near_sdk::serde_json::from_value(closed.get("state").cloned().ok_or("no state")?)?;
        assert_eq!(state, TaskState::Closed);
        let bids = closed["bids"].as_array().ok_or("no bids")?;
        assert_eq!(bids.len(), bidders.len());
        assert!(bids.iter().any(|b| b["price"] == json!(u64::MAX)));
        let expected = if id == "mixed" { &cheap } else { &whale };
        assert_eq!(closed["winner"], json!(expected.account_id()), "{id}");
    }

    call(
        &contract,
        &network,
        &signer,
        &whale,
        "submit_result",
        json!({"task_id": "solo", "result_hash": "h"}),
        0,
    )
    .await?;
    call(
        &contract,
        &network,
        &signer,
        &verifier,
        "attest",
        json!({"task_id": "solo", "ok": true}),
        0,
    )
    .await?;
    let settled = get_task(&contract, &network, "solo").await?;
    let state: TaskState =
        near_sdk::serde_json::from_value(settled.get("state").cloned().ok_or("no state")?)?;
    assert_eq!(state, TaskState::Settled);
    Ok(())
}
