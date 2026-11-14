// test_close_round_gas_sandbox.rs v1.0
// Red team: real (sandbox, receipts included) gas of close_round as a function
// of revealed bids. Two tasks closed with SMALL and LARGE bid counts give the
// per-bid slope; extrapolate to MAX_BIDS_PER_TASK=512 and require the worst
// case (~51 Tgas measured: caller must attach >30 Tgas default) to stay under
// 100 Tgas, far from the 300 Tgas tx cap (else a Sybil flood freezes escrow).
const SANDBOX_VERSION: &str = "2.14.0";
use near_api::types::transaction::result::TransactionResult;
use near_api::{Contract, NetworkConfig, Signer};
use near_sdk::serde_json::{json, Value};
use near_sdk::NearToken;
use sha2::{Digest, Sha256};
use std::sync::Arc;

const SMALL: usize = 4;
const LARGE: usize = 36;
const MAX_BIDS_PER_TASK: u64 = 512;
const TX_CAP_GAS: u64 = 300_000_000_000_000;

async fn gas(
    contract: Contract,
    network: NetworkConfig,
    signer: Arc<Signer>,
    who: String,
    method: &'static str,
    args: Value,
    deposit: u128,
) -> testresult::TestResult<u64> {
    let outcome = contract
        .call_function(method, args)
        .transaction()
        .deposit(NearToken::from_yoctonear(deposit))
        .with_signer(who.parse()?, signer)
        .send_to(&network)
        .await?;
    let TransactionResult::Full(full) = outcome else {
        return Err("no full outcome".into());
    };
    assert!(full.is_success(), "{method} by {who} failed: {full:?}");
    Ok(full.total_gas_burnt.as_gas())
}

fn commitment(price: u64, salt: u32, who: &str) -> Vec<u8> {
    let mut p = Vec::new();
    p.extend_from_slice(&price.to_be_bytes());
    p.extend_from_slice(&salt.to_be_bytes());
    p.extend_from_slice(who.as_bytes());
    Sha256::digest(p).to_vec()
}

async fn fan_out(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &Arc<Signer>,
    calls: Vec<(String, &'static str, Value)>,
) -> testresult::TestResult<()> {
    let mut set = tokio::task::JoinSet::new();
    for (who, method, args) in calls {
        set.spawn(gas(contract.clone(), network.clone(), signer.clone(), who, method, args, 0));
    }
    while let Some(r) = set.join_next().await {
        r??;
    }
    Ok(())
}

#[tokio::test]
async fn close_round_gas_at_bid_cap_is_bounded() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    // Long (64-char) worker ids: worst case for the per-bid key/reputation reads.
    let workers: Vec<String> = (0..LARGE)
        .map(|i| format!("w{i:02}{}.sandbox", "x".repeat(53)))
        .collect();
    for n in ["publisher.sandbox", "market.sandbox"]
        .into_iter()
        .map(String::from)
        .chain(workers.iter().cloned())
    {
        sandbox
            .create_account(n.parse()?)
            .initial_balance(NearToken::from_near(5))
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

    let p = "publisher.sandbox".to_string();
    for id in ["small", "large"] {
        gas(contract.clone(), network.clone(), signer.clone(), p.clone(), "post_task",
            json!({"id": id, "verifier": p, "commit_len": 400, "reveal_len": 400}), 1_000).await?;
    }
    let mut regs = Vec::new();
    let mut commits = Vec::new();
    let mut reveals = Vec::new();
    for (i, w) in workers.iter().enumerate() {
        regs.push((w.clone(), "register_worker", json!({})));
        let price = 500 - i as u64;
        let mut tasks = vec!["large"];
        if i < SMALL {
            tasks.push("small");
        }
        for t in tasks {
            commits.push((w.clone(), "commit_bid",
                json!({"task_id": t, "commitment": commitment(price, 7 + i as u32, w)})));
            reveals.push((w.clone(), "reveal_bid", json!({"task_id": t, "price": price, "salt": 7 + i as u32})));
        }
    }
    fan_out(&contract, &network, &signer, regs).await?;
    // Same signer account per task pair: commits for one worker must not race on nonce.
    let (c_small, c_large): (Vec<_>, Vec<_>) =
        commits.into_iter().partition(|c| c.2["task_id"] == "small");
    fan_out(&contract, &network, &signer, c_large).await?;
    fan_out(&contract, &network, &signer, c_small).await?;
    sandbox.fast_forward(400).await?;
    let (r_small, r_large): (Vec<_>, Vec<_>) =
        reveals.into_iter().partition(|c| c.2["task_id"] == "small");
    fan_out(&contract, &network, &signer, r_large).await?;
    fan_out(&contract, &network, &signer, r_small).await?;
    sandbox.fast_forward(400).await?;

    let g_small = gas(contract.clone(), network.clone(), signer.clone(), p.clone(), "close_round",
        json!({"task_id": "small"}), 0).await?;
    let g_large = gas(contract.clone(), network.clone(), signer.clone(), p.clone(), "close_round",
        json!({"task_id": "large"}), 0).await?;

    let slope = g_large.saturating_sub(g_small) / (LARGE - SMALL) as u64;
    let worst = g_large + slope * (MAX_BIDS_PER_TASK - LARGE as u64);
    let bids_to_cap = (TX_CAP_GAS - g_large) / slope.max(1) + LARGE as u64;
    println!(
        "close_round sandbox gas: {SMALL} bids {:.3} Tgas, {LARGE} bids {:.3} Tgas, slope {:.2} Ggas/bid, \
         extrapolated {MAX_BIDS_PER_TASK} bids {:.3} Tgas, ~{bids_to_cap} bids to 300 Tgas",
        g_small as f64 / 1e12, g_large as f64 / 1e12, slope as f64 / 1e9, worst as f64 / 1e12
    );
    assert!(g_large > g_small, "close_round gas must grow with bids");
    assert!(worst < 100_000_000_000_000, "512-bid close_round ~{worst} gas >= 100 Tgas");
    assert!(bids_to_cap > 4 * MAX_BIDS_PER_TASK, "300 Tgas reached at {bids_to_cap} bids");
    Ok(())
}
