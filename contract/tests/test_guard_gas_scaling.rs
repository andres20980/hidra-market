// test_guard_gas_scaling.rs v1.0
// Red team: require_storage_reserve sums escrow over EVERY stored task, so the
// gas of post_task / register_worker / commit_bid grows with task count.
// Measure the per-task slope on a real sandbox and extrapolate how many stored
// tasks it takes before a guarded call hits the 300 Tgas tx cap (market DoS).
const SANDBOX_VERSION: &str = "2.14.0";
use near_api::types::transaction::result::TransactionResult;
use near_api::{Contract, NetworkConfig, Signer};
use near_sdk::serde_json::{json, Value};
use near_sdk::NearToken;

const TX_CAP_GAS: u64 = 300_000_000_000_000;
const SPAM_TASKS: u64 = 60;

async fn gas(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    who: &str,
    method: &str,
    args: Value,
    deposit: u128,
) -> testresult::TestResult<u64> {
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
    Ok(full.total_gas_burnt.as_gas())
}

#[tokio::test]
async fn guard_gas_slope_per_stored_task() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    for n in ["attacker", "early", "late", "market"] {
        sandbox
            .create_account(format!("{n}.sandbox").parse()?)
            .initial_balance(NearToken::from_near(10))
            .send()
            .await?;
    }
    let contract = Contract("market.sandbox".parse()?);
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

    let a = "attacker.sandbox";
    let post = |n: u64| {
        json!({"id": format!("t-{n:03}{}", "x".repeat(58)), "verifier": a,
               "commit_len": 10, "reveal_len": 10})
    };
    let first_post = gas(&contract, &network, &signer, a, "post_task", post(0), 1).await?;
    let early_reg = gas(&contract, &network, &signer, "early.sandbox", "register_worker", json!({}), 0).await?;
    let mut last_post = first_post;
    for n in 1..SPAM_TASKS {
        last_post = gas(&contract, &network, &signer, a, "post_task", post(n), 1).await?;
    }
    let late_reg = gas(&contract, &network, &signer, "late.sandbox", "register_worker", json!({}), 0).await?;

    let span = SPAM_TASKS - 1;
    let post_slope = last_post.saturating_sub(first_post) / span;
    let reg_slope = late_reg.saturating_sub(early_reg) / span;
    let slope = post_slope.max(reg_slope).max(1);
    let tasks_to_cap = (TX_CAP_GAS - last_post.max(late_reg)) / slope + SPAM_TASKS;
    println!(
        "post_task gas 1 task={first_post} {SPAM_TASKS} tasks={last_post} slope={post_slope}/task; \
         register_worker 1 task={early_reg} {SPAM_TASKS} tasks={late_reg} slope={reg_slope}/task; \
         tasks_to_300Tgas~{tasks_to_cap}"
    );
    // Before the running escrow total: ~180 Ggas/task, 300 Tgas cap at ~1650 tasks.
    assert!(slope < 10_000_000_000, "guard gas grows {slope} gas per stored task");
    assert!(tasks_to_cap > 10_000, "market bricks after ~{tasks_to_cap} stored tasks");
    assert!(last_post < 15_000_000_000_000 && late_reg < 15_000_000_000_000);
    Ok(())
}
