// test_storage_griefing.rs v1.0
// Adversarial: storage staking griefing. No method charges the caller for the
// state it writes; `result_hash` (and `id`) are unbounded. An attacker runs a
// 1-yocto task of its own (publisher = verifier = winner) and submits a huge
// `result_hash`. Storage is paid from the contract balance, which also holds
// every publisher's escrow. Once the free balance drops below an honest
// reward, the transfer in `attest` / `refund_expired` would leave the contract
// unable to cover its storage: the receipt fails with LackBalanceForState and
// the honest escrow is frozen.
// FIXED: src/ now bounds the byte length of `id` (post_task) and `result_hash`
// (submit_result), so the bloat is rejected and the honest escrow is never
// frozen. This test asserts the rejection and that the honest round settles.
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::{Data, Reference};
use near_api::{Account, Contract, NetworkConfig, Signer, Tokens};
use near_sdk::NearToken;
use near_sdk::serde_json::{Value, json};
use sha2::{Digest, Sha256};

const STORAGE_PRICE_PER_BYTE: u128 = 10_000_000_000_000_000_000;

async fn create_subaccount(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
    near: u128,
) -> testresult::TestResult<Account> {
    let id: near_sdk::AccountId = name.parse()?;
    sandbox
        .create_account(id)
        .initial_balance(NearToken::from_near(near))
        .send()
        .await?;
    Ok(Account(name.parse()?))
}

fn commitment(price: u64, salt: u32, worker: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&price.to_be_bytes());
    payload.extend_from_slice(&salt.to_be_bytes());
    payload.extend_from_slice(worker.as_bytes());
    Sha256::digest(payload).to_vec()
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

fn state_of(task: &Value) -> testresult::TestResult<TaskState> {
    Ok(near_sdk::serde_json::from_value(
        task.get("state").cloned().ok_or("no state")?,
    )?)
}

async fn free_balance(
    contract: &Contract,
    network: &NetworkConfig,
) -> testresult::TestResult<u128> {
    let b = Tokens::account(contract.account_id().clone())
        .near_balance()
        .fetch_from(network)
        .await?;
    Ok(b.total.as_yoctonear() - u128::from(b.storage_usage) * STORAGE_PRICE_PER_BYTE)
}

async fn call(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    who: &Account,
    method: &str,
    args: Value,
    deposit: u128,
) -> testresult::TestResult<Result<(), String>> {
    let outcome = contract
        .call_function(method, args)
        .transaction()
        .deposit(NearToken::from_yoctonear(deposit))
        .with_signer(who.account_id().clone(), signer.clone())
        .send_to(network)
        .await?;
    Ok(match outcome.into_result() {
        Ok(_) => Ok(()),
        Err(failure) => Err(format!("{failure:?}")),
    })
}

#[tokio::test]
async fn test_storage_griefing_freezes_honest_escrow() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let publisher = create_subaccount(&sandbox, "publisher.sandbox", 10).await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox", 10).await?;
    let worker = create_subaccount(&sandbox, "worker.sandbox", 10).await?;
    let attacker = create_subaccount(&sandbox, "attacker.sandbox", 10).await?;
    let contract = create_subaccount(&sandbox, "market.sandbox", 3)
        .await?
        .as_contract();

    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    let wasm_path = format!("{target_dir}/wasm32-unknown-unknown/release/contract.wasm");
    Contract::deploy(contract.account_id().clone())
        .use_code(std::fs::read(wasm_path)?)
        .with_init_call(
            "init",
            json!({"cap_per_agent": 2_000_000_000_000_000_000_u64}),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // Reward below the per-agent cap so the honest round settles (pays the
    // winner) once the griefing write is rejected. Kept within u64 so it can be
    // passed as a JSON number alongside `cap_per_agent`.
    let reward: u128 = NearToken::from_yoctonear(1_000_000_000_000_000_000).as_yoctonear();
    for (who, id, verif, dep) in [
        (&publisher, "honest", verifier.account_id().clone(), reward),
        (&attacker, "grief", attacker.account_id().clone(), 1),
    ] {
        call(
            &contract,
            &network,
            &signer,
            who,
            "post_task",
            json!({"id": id, "verifier": verif, "commit_len": 100, "reveal_len": 100}),
            dep,
        )
        .await??;
    }

    // Guard 1: an over-long task id (> MAX_ID_LEN = 64 B) is rejected, so the
    // attacker cannot grief via a huge storage key either.
    let long_id = "z".repeat(65);
    let long_id_res = call(
        &contract,
        &network,
        &signer,
        &attacker,
        "post_task",
        json!({"id": long_id, "verifier": attacker.account_id().clone(), "commit_len": 100, "reveal_len": 100}),
        1,
    )
    .await?;
    let msg = long_id_res.expect_err("BUG: long task id accepted");
    assert!(msg.contains("Task id length out of bounds"), "long id: {msg}");

    for (who, id, price, salt) in [
        (&worker, "honest", 500_u64, 7_u32),
        (&attacker, "grief", 1, 1),
    ] {
        call(
            &contract,
            &network,
            &signer,
            who,
            "register_worker",
            json!({}),
            0,
        )
        .await??;
        let c = commitment(price, salt, who.account_id().as_str());
        call(
            &contract,
            &network,
            &signer,
            who,
            "commit_bid",
            json!({"task_id": id, "commitment": c}),
            0,
        )
        .await??;
    }
    sandbox.fast_forward(100).await?;
    for (who, id, price, salt) in [
        (&worker, "honest", 500_u64, 7_u32),
        (&attacker, "grief", 1, 1),
    ] {
        call(
            &contract,
            &network,
            &signer,
            who,
            "reveal_bid",
            json!({"task_id": id, "price": price, "salt": salt}),
            0,
        )
        .await??;
    }
    sandbox.fast_forward(100).await?;
    for id in ["honest", "grief"] {
        call(
            &contract,
            &network,
            &signer,
            &publisher,
            "close_round",
            json!({"task_id": id}),
            0,
        )
        .await??;
    }
    call(
        &contract,
        &network,
        &signer,
        &worker,
        "submit_result",
        json!({"task_id": "honest", "result_hash": "sha256:ok"}),
        0,
    )
    .await??;

    // Free balance covers the honest reward before the attack attempt.
    let free_before = free_balance(&contract, &network).await?;
    assert!(free_before > reward, "setup: free {free_before} <= reward");

    // Guard 2: the griefing submit_result that would bloat state by ~free_before
    // bytes is now rejected (result_hash > MAX_RESULT_HASH_LEN = 128 B). The
    // storage is never written, so the free balance cannot drop below an escrow.
    let bloat_bytes = usize::try_from((free_before - reward / 2) / STORAGE_PRICE_PER_BYTE)?;
    let junk = "x".repeat(bloat_bytes);
    let grief = call(
        &contract,
        &network,
        &signer,
        &attacker,
        "submit_result",
        json!({"task_id": "grief", "result_hash": junk}),
        0,
    )
    .await?;
    let msg = grief.expect_err("BUG: oversized result_hash accepted");
    assert!(
        msg.contains("Result hash length out of bounds"),
        "grief: unexpected failure: {msg}"
    );
    let free_after = free_balance(&contract, &network).await?;
    assert!(
        free_after > reward,
        "rejected write still bit: free {free_after} <= reward {reward}"
    );

    // The honest round now settles normally: the escrow is not frozen.
    call(
        &contract,
        &network,
        &signer,
        &verifier,
        "attest",
        json!({"task_id": "honest", "ok": true}),
        0,
    )
    .await??;
    assert_eq!(
        state_of(&get_task(&contract, &network, "honest").await?)?,
        TaskState::Settled
    );

    println!(
        "griefing blocked: long id and {bloat_bytes}-B result_hash rejected; free {free_before} -> {free_after}; honest escrow settled"
    );
    Ok(())
}
