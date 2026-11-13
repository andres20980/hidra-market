// test_sybil_two_accounts.rs v1.0
// RED TEAM: the per-agent spend cap is keyed by on-chain `account_id`, so it is
// a per-ACCOUNT cap, not a per-OPERATOR cap. An operator that controls two
// registered accounts gets two independent caps and can be paid up to the cap
// on EACH of them in the same market. This test pins that boundary end-to-end:
// it is a documented limitation (NEAR has no on-chain identity to bind Sybil
// accounts to one operator), NOT a contract bug. Making it a green test means a
// reviewer sees exactly where the cap's guarantee stops. Complements the
// cumulative-cap guarantee proved per-account in test_cap_cumulative.rs.
// Pin the neard ledger version so a clean clone fetches the exact same binary.
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::Data;
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

async fn task_state(
    contract: &Contract,
    network: &NetworkConfig,
    task_id: &str,
) -> testresult::TestResult<TaskState> {
    let raw: Data<Option<Value>> = contract
        .call_function("get_task", json!({ "task_id": task_id }))
        .read_only()
        .fetch_from(network)
        .await?;
    let task = raw.data.ok_or("task not found")?;
    let state = task.get("state").cloned().ok_or("task has no state")?;
    Ok(near_sdk::serde_json::from_value(state)?)
}

/// Drive one full round where `worker` is the sole bidder and the verifier
/// accepts the result. `reward_yocto` is escrowed by the publisher.
#[allow(clippy::too_many_arguments)]
async fn run_round(
    contract: &Contract,
    network: &NetworkConfig,
    sandbox: &near_sandbox::Sandbox,
    signer: std::sync::Arc<Signer>,
    publisher: &Account,
    verifier: &Account,
    worker: &Account,
    round_id: &str,
    reward_yocto: u128,
    salt: u32,
) -> testresult::TestResult<()> {
    contract
        .call_function(
            "post_task",
            json!({
                "id": round_id,
                "verifier": verifier.account_id(),
                "commit_len": 100,
                "reveal_len": 100,
            }),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(reward_yocto))
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();

    let mut payload = Vec::new();
    payload.extend_from_slice(&100_u64.to_be_bytes());
    payload.extend_from_slice(&salt.to_be_bytes());
    payload.extend_from_slice(worker.account_id().as_str().as_bytes());
    let commitment = Sha256::digest(payload).to_vec();
    contract
        .call_function(
            "commit_bid",
            json!({ "task_id": round_id, "commitment": commitment }),
        )
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();

    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({ "task_id": round_id, "price": 100, "salt": salt }),
        )
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();

    sandbox.fast_forward(100).await?;
    contract
        .call_function("close_round", json!({ "task_id": round_id }))
        .transaction()
        .with_signer(publisher.account_id().clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();

    contract
        .call_function(
            "submit_result",
            json!({ "task_id": round_id, "result_hash": "sha256:result" }),
        )
        .transaction()
        .with_signer(worker.account_id().clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();

    contract
        .call_function("attest", json!({ "task_id": round_id, "ok": true }))
        .transaction()
        .with_signer(verifier.account_id().clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();

    Ok(())
}

#[tokio::test]
async fn test_sybil_two_accounts_get_two_independent_caps() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    // Two accounts controlled by the same off-chain operator.
    let worker_a = create_subaccount(&sandbox, "sybil-a.sandbox").await?;
    let worker_b = create_subaccount(&sandbox, "sybil-b.sandbox").await?;
    let contract = create_subaccount(&sandbox, "market.sandbox")
        .await?
        .as_contract();

    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    let wasm_path = format!("{target_dir}/wasm32-unknown-unknown/release/contract.wasm");
    // cap 1500 yocto per account: a single 1000-yocto reward fits each account,
    // but 2000 would exceed it on a single account (see test_cap_cumulative.rs).
    Contract::deploy(contract.account_id().clone())
        .use_code(std::fs::read(wasm_path)?)
        .with_init_call("init", json!({ "cap_per_agent": 1_500_u128 }))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    for worker in [&worker_a, &worker_b] {
        contract
            .call_function("register_worker", json!({}))
            .transaction()
            .with_signer(worker.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }

    // Round A: sybil-a wins, reward 1000 <= cap 1500 => Settled.
    run_round(
        &contract,
        &network,
        &sandbox,
        signer.clone(),
        &publisher,
        &verifier,
        &worker_a,
        "round-a",
        1_000,
        1,
    )
    .await?;
    assert_eq!(
        task_state(&contract, &network, "round-a").await?,
        TaskState::Settled,
        "sybil-a within its own cap must settle"
    );

    // Round B: the SAME operator's second account also wins reward 1000. Because
    // the cap is per account_id, sybil-b's spend is tracked independently and
    // 1000 <= 1500 => Settled. Combined the operator was paid 2000, double what a
    // single account could earn. This is the documented Sybil boundary.
    run_round(
        &contract,
        &network,
        &sandbox,
        signer.clone(),
        &publisher,
        &verifier,
        &worker_b,
        "round-b",
        1_000,
        2,
    )
    .await?;
    assert_eq!(
        task_state(&contract, &network, "round-b").await?,
        TaskState::Settled,
        "sybil-b has an independent per-account cap and must also settle"
    );

    // Each account recorded exactly one successful settlement: Beta(alpha=2, beta=1).
    for worker in [&worker_a, &worker_b] {
        let rep: Data<(String, String, String)> = contract
            .call_function("get_reputation", json!({ "account": worker.account_id() }))
            .read_only()
            .fetch_from(&network)
            .await?;
        assert_eq!(
            rep.data,
            (
                "2".to_string(),
                "1".to_string(),
                (2.0_f64 / 3.0_f64).to_string()
            ),
            "each Sybil account carries its own independent reputation"
        );
    }

    Ok(())
}
