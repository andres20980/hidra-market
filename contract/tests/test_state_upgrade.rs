// test_state_upgrade.rs v1.0
// Red team: contract upgrade with existing state. The LISTO-DEPLOY redeploy
// (enjambre pushes the same-layout wasm over the live testnet account) must NOT
// need a migration: redeploying the code WITHOUT an init call has to preserve
// every piece of state (tasks, registered workers, open bids, Beta reputation)
// and let an in-flight round finish. We populate state, redeploy the same wasm
// without init, and assert the state is byte-identical and the round settles.
// Pin neard.
const SANDBOX_VERSION: &str = "2.14.0";
use near_api::types::{Data, Reference};
use near_api::{Contract, NetworkConfig, Signer};
use near_sdk::NearToken;
use near_sdk::serde_json::{Value, json};
use sha2::{Digest, Sha256};

fn commitment(price: u64, salt: u32, worker: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&price.to_be_bytes());
    payload.extend_from_slice(&salt.to_be_bytes());
    payload.extend_from_slice(worker.as_bytes());
    Sha256::digest(payload).to_vec()
}

async fn send(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    who: &str,
    method: &str,
    args: Value,
    deposit: u128,
) -> testresult::TestResult<()> {
    contract
        .call_function(method, args)
        .transaction()
        .deposit(NearToken::from_yoctonear(deposit))
        .with_signer(who.parse()?, signer.clone())
        .send_to(network)
        .await?
        .assert_success();
    Ok(())
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

async fn reputation(
    contract: &Contract,
    network: &NetworkConfig,
    who: &str,
) -> testresult::TestResult<(String, String, String)> {
    let raw: Data<(String, String, String)> = contract
        .call_function("get_reputation", json!({ "account": who }))
        .read_only()
        .at(Reference::Final)
        .fetch_from(network)
        .await?;
    Ok(raw.data)
}

#[tokio::test]
async fn redeploy_same_layout_preserves_state_without_migration() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer =
        Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;
    // Create market.sandbox explicitly so it holds the genesis key and can sign
    // its own redeploy (the without-init upgrade must be signed by the account).
    for n in ["publisher", "verifier", "winner", "market"] {
        sandbox
            .create_account(format!("{n}.sandbox").parse()?)
            .initial_balance(NearToken::from_near(10))
            .send()
            .await?;
    }
    let (p, v, w) = ("publisher.sandbox", "verifier.sandbox", "winner.sandbox");
    let contract = Contract("market.sandbox".parse()?);
    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    let wasm = std::fs::read(format!(
        "{target_dir}/wasm32-unknown-unknown/release/contract.wasm"
    ))?;

    // --- first deploy + populate rich state across every collection -----------
    Contract::deploy(contract.account_id().clone())
        .use_code(wasm.clone())
        .with_init_call("init", json!({"cap_per_agent": 10_000_u128}))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    send(&contract, &network, &signer, p, "post_task",
        json!({"id": "job", "verifier": v, "commit_len": 100, "reveal_len": 100}),
        1_000).await?;
    send(&contract, &network, &signer, w, "register_worker", json!({}), 0).await?;
    send(&contract, &network, &signer, w, "commit_bid",
        json!({"task_id": "job", "commitment": commitment(400, 9, w)}), 0).await?;
    sandbox.fast_forward(100).await?;
    send(&contract, &network, &signer, w, "reveal_bid",
        json!({"task_id": "job", "price": 400, "salt": 9}), 0).await?;

    let task_before = get_task(&contract, &network, "job").await?;
    let rep_before = reputation(&contract, &network, w).await?;

    // --- redeploy the SAME wasm with NO init call (the LISTO-DEPLOY path) ------
    Contract::deploy(contract.account_id().clone())
        .use_code(wasm)
        .without_init_call()
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // --- state must be byte-identical: no migration, no reset ----------------
    let task_after = get_task(&contract, &network, "job").await?;
    let rep_after = reputation(&contract, &network, w).await?;
    assert_eq!(task_before, task_after, "task state changed across redeploy");
    assert_eq!(rep_before, rep_after, "reputation changed across redeploy");

    // --- the in-flight round still settles on the upgraded code --------------
    sandbox.fast_forward(100).await?;
    send(&contract, &network, &signer, p, "close_round", json!({"task_id": "job"}), 0).await?;
    send(&contract, &network, &signer, w, "submit_result",
        json!({"task_id": "job", "result_hash": "sha256:feed"}), 0).await?;
    send(&contract, &network, &signer, v, "attest",
        json!({"task_id": "job", "ok": true}), 0).await?;

    // honest work after the upgrade bumps Beta alpha: reputation keeps growing
    let (a_before, _, _) = rep_before;
    let (a_after, _, _) = reputation(&contract, &network, w).await?;
    assert!(
        a_after.parse::<f64>()? > a_before.parse::<f64>()?,
        "alpha did not grow after settling the round post-upgrade: {a_before} -> {a_after}"
    );
    Ok(())
}
