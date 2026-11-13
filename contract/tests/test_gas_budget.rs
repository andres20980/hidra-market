// test_gas_budget.rs v1.0
// Red team: measured gas burnt per contract function over the full lifecycle
// (receipts included). Each call must stay under a per-function budget well
// below the 300 Tgas tx cap, so no honest caller needs more than the default
// 30 Tgas. Table printed with --nocapture. Pin neard.
const SANDBOX_VERSION: &str = "2.14.0";
use near_api::types::transaction::result::TransactionResult;
use near_api::{Contract, NetworkConfig, Signer};
use near_sdk::serde_json::{json, Value};
use near_sdk::NearToken;
use sha2::{Digest, Sha256};

const BUDGET_TGAS: u64 = 15;

async fn call(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    who: &str,
    method: &str,
    args: Value,
    deposit: u128,
    rows: &mut Vec<(String, u64)>,
) -> testresult::TestResult<()> {
    let outcome = contract
        .call_function(method, args)
        .transaction()
        .deposit(NearToken::from_yoctonear(deposit))
        .with_signer(who.parse()?, signer.clone())
        .send_to(network)
        .await?;
    let TransactionResult::Full(full) = outcome else {
        return Err("no full outcome".into());
    };
    assert!(full.is_success(), "{method} failed: {full:?}");
    rows.push((method.to_string(), full.total_gas_burnt.as_gas()));
    Ok(())
}

#[tokio::test]
async fn test_gas_per_function_within_budget() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    for n in ["publisher", "verifier", "winner", "outsider", "market"] {
        sandbox
            .create_account(format!("{n}.sandbox").parse()?)
            .initial_balance(NearToken::from_near(10))
            .send()
            .await?;
    }
    let contract = Contract(format!("market.sandbox").parse()?);
    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    Contract::deploy(contract.account_id().clone())
        .use_code(std::fs::read(format!(
            "{target_dir}/wasm32-unknown-unknown/release/contract.wasm"
        ))?)
        .with_init_call("init", json!({"cap_per_agent": 10_000_u128}))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let mut rows = Vec::new();
    let (p, v, w, o) = (
        "publisher.sandbox",
        "verifier.sandbox",
        "winner.sandbox",
        "outsider.sandbox",
    );
    for id in ["paid", "empty"] {
        call(&contract, &network, &signer, p, "post_task",
            json!({"id": id, "verifier": v, "commit_len": 100, "reveal_len": 100}),
            1_000, &mut rows).await?;
    }
    call(&contract, &network, &signer, w, "register_worker", json!({}), 0, &mut rows).await?;
    let mut payload = Vec::new();
    payload.extend_from_slice(&400u64.to_be_bytes());
    payload.extend_from_slice(&9u32.to_be_bytes());
    payload.extend_from_slice(w.as_bytes());
    let c = Sha256::digest(payload).to_vec();
    call(&contract, &network, &signer, w, "commit_bid",
        json!({"task_id": "paid", "commitment": c}), 0, &mut rows).await?;
    sandbox.fast_forward(100).await?;
    call(&contract, &network, &signer, w, "reveal_bid",
        json!({"task_id": "paid", "price": 400, "salt": 9}), 0, &mut rows).await?;
    sandbox.fast_forward(100).await?;
    for id in ["paid", "empty"] {
        call(&contract, &network, &signer, p, "close_round",
            json!({"task_id": id}), 0, &mut rows).await?;
    }
    call(&contract, &network, &signer, w, "submit_result",
        json!({"task_id": "paid", "result_hash": "sha256:feed"}), 0, &mut rows).await?;
    call(&contract, &network, &signer, v, "attest",
        json!({"task_id": "paid", "ok": true}), 0, &mut rows).await?;
    sandbox.fast_forward(101).await?;
    call(&contract, &network, &signer, o, "refund_expired",
        json!({"task_id": "empty"}), 0, &mut rows).await?;

    let budget = BUDGET_TGAS * 1_000_000_000_000;
    for (m, g) in &rows {
        println!("GAS {m:<16} {:>8.3} Tgas", *g as f64 / 1e12);
        assert!(*g < budget, "{m} burnt {g} gas >= {BUDGET_TGAS} Tgas budget");
    }
    Ok(())
}
