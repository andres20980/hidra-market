// test_reentrancy_contract_payee.rs v1.0
// Adversarial: reentrancy through payouts. The winner and the publisher are
// accounts WITH contract code deployed (the market wasm itself, initialised,
// standing in for an attacker contract). Every payout is a plain
// `Promise::transfer(..).detach()` with no callback, and NEAR Transfer
// actions never execute the receiver's code, so the payee cannot re-enter
// attest/refund_expired. Checks: payouts succeed with zero failed receipts,
// no receipt runs code on the payee (no logs, no outgoing receipts), the
// payee contract state is untouched, each payee gets exactly +1000y, the
// market pays once and a second attest/refund is rejected. Pin neard.
const SANDBOX_VERSION: &str = "2.14.0";
use contract::TaskState;
use near_api::types::transaction::result::TransactionResult;
use near_api::types::{Data, Reference};
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

fn state_of(task: &Value) -> testresult::TestResult<TaskState> {
    Ok(near_sdk::serde_json::from_value(
        task.get("state").cloned().ok_or("no state")?,
    )?)
}

async fn deploy_market(
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    account: &Account,
    code: &[u8],
) -> testresult::TestResult<Contract> {
    Contract::deploy(account.account_id().clone())
        .use_code(code.to_vec())
        .with_init_call("init", json!({"cap_per_agent": 10_000_u128}))?
        .with_signer(signer.clone())
        .send_to(network)
        .await?
        .assert_success();
    Ok(account.clone().as_contract())
}

async fn payee_tasks(payee: &Contract, network: &NetworkConfig) -> testresult::TestResult<usize> {
    let raw: Data<Vec<Value>> = payee
        .call_function("list_tasks", json!({"from": 0, "limit": 50}))
        .read_only()
        .at(Reference::Final)
        .fetch_from(network)
        .await?;
    Ok(raw.data.len())
}

// Sends a money call and asserts no receipt executed code on `payee`.
async fn pay_and_check_no_reentry(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    caller: &Account,
    payee: &Account,
    method: &str,
    args: Value,
) -> testresult::TestResult<()> {
    let outcome = contract
        .call_function(method, args)
        .transaction()
        .with_signer(caller.account_id().clone(), signer.clone())
        .send_to(network)
        .await?;
    let TransactionResult::Full(full) = outcome else {
        return Err(format!("{method} still pending").into());
    };
    assert!(full.is_success(), "{method} must succeed: {full:?}");
    assert!(
        full.receipt_failures().is_empty(),
        "{method}: failed receipts"
    );
    // Trace: market runs once, the Transfer lands on the payee, and the only
    // follow-up is the protocol gas refund to the signer. Any reentry would
    // show up as a second outcome executed on the market.
    let market_runs = full
        .receipt_outcomes()
        .iter()
        .filter(|o| &o.executor_id == contract.account_id())
        .count();
    assert_eq!(market_runs, 1, "{method}: market re-entered");
    let on_payee: Vec<_> = full
        .receipt_outcomes()
        .iter()
        .filter(|o| &o.executor_id == payee.account_id())
        .collect();
    assert_eq!(
        on_payee.len(),
        1,
        "{method}: exactly the transfer lands on payee"
    );
    for o in &on_payee {
        assert!(o.logs.is_empty(), "{method}: payee code ran: {:?}", o.logs);
        // A FunctionCall costs >= 2.3 Tgas base; a bare Transfer ~0.22 Tgas.
        assert!(
            o.gas_burnt.as_gas() < 1_000_000_000_000,
            "{method}: payee executed wasm ({} gas)",
            o.gas_burnt.as_gas()
        );
    }
    for o in full.receipt_outcomes() {
        assert!(
            &o.executor_id == contract.account_id()
                || &o.executor_id == payee.account_id()
                || &o.executor_id == caller.account_id(),
            "{method}: unexpected receipt on {}",
            o.executor_id
        );
    }
    Ok(())
}

async fn expect_rejected(
    contract: &Contract,
    network: &NetworkConfig,
    signer: &std::sync::Arc<Signer>,
    caller: &Account,
    method: &str,
    args: Value,
) -> testresult::TestResult<()> {
    let result = contract
        .call_function(method, args)
        .transaction()
        .with_signer(caller.account_id().clone(), signer.clone())
        .send_to(network)
        .await;
    if let Ok(r) = result {
        assert!(r.into_result().is_err(), "{method} replay succeeded");
    }
    Ok(())
}

#[tokio::test]
async fn test_contract_payees_cannot_reenter_payouts() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(SANDBOX_VERSION).await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    let publisher = create_subaccount(&sandbox, "publisher.sandbox").await?;
    let verifier = create_subaccount(&sandbox, "verifier.sandbox").await?;
    let attacker = create_subaccount(&sandbox, "attacker.sandbox").await?;
    let market = create_subaccount(&sandbox, "market.sandbox").await?;
    let target_dir = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".to_string());
    let code = std::fs::read(format!(
        "{target_dir}/wasm32-unknown-unknown/release/contract.wasm"
    ))?;
    let contract = deploy_market(&network, &signer, &market, &code).await?;
    // Both payees carry live contract code.
    let attacker_c = deploy_market(&network, &signer, &attacker, &code).await?;
    let publisher_c = deploy_market(&network, &signer, &publisher, &code).await?;

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
        .with_signer(attacker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let c = commitment(400, 7, attacker.account_id().as_str());
    contract
        .call_function("commit_bid", json!({"task_id": "paid", "commitment": c}))
        .transaction()
        .with_signer(attacker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    contract
        .call_function(
            "reveal_bid",
            json!({"task_id": "paid", "price": 400, "salt": 7}),
        )
        .transaction()
        .with_signer(attacker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    sandbox.fast_forward(100).await?;
    for id in ["paid", "empty"] {
        contract
            .call_function("close_round", json!({"task_id": id}))
            .transaction()
            .with_signer(verifier.account_id().clone(), signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
    }
    contract
        .call_function(
            "submit_result",
            json!({"task_id": "paid", "result_hash": "sha256:beef"}),
        )
        .transaction()
        .with_signer(attacker.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    // 1) attest pays a contract-bearing winner: transfer only, no code runs.
    let attacker_before = near_balance(&network, &attacker).await?;
    let market_before = contract_balance(&contract, &network).await?;
    pay_and_check_no_reentry(
        &contract,
        &network,
        &signer,
        &verifier,
        &attacker,
        "attest",
        json!({"task_id": "paid", "ok": true}),
    )
    .await?;
    assert_eq!(
        state_of(&get_task(&contract, &network, "paid").await?)?,
        TaskState::Settled
    );
    assert_eq!(
        near_balance(&network, &attacker).await? - attacker_before,
        1_000,
        "winner contract must receive exactly the reward"
    );
    assert!(contract_balance(&contract, &network).await? + 1_000 >= market_before);
    assert_eq!(
        payee_tasks(&attacker_c, &network).await?,
        0,
        "payee state touched"
    );
    let rep = reputation(&contract, &network, &attacker).await?;
    assert_eq!((rep.0.as_str(), rep.1.as_str()), ("2", "1"));
    expect_rejected(
        &contract,
        &network,
        &signer,
        &verifier,
        "attest",
        json!({"task_id": "paid", "ok": true}),
    )
    .await?;
    assert_eq!(reputation(&contract, &network, &attacker).await?, rep);

    // 2) refund_expired pays a contract-bearing publisher: same guarantees.
    sandbox.fast_forward(101).await?;
    let publisher_before = near_balance(&network, &publisher).await?;
    pay_and_check_no_reentry(
        &contract,
        &network,
        &signer,
        &verifier,
        &publisher,
        "refund_expired",
        json!({"task_id": "empty"}),
    )
    .await?;
    assert_eq!(
        state_of(&get_task(&contract, &network, "empty").await?)?,
        TaskState::Refunded
    );
    assert_eq!(
        near_balance(&network, &publisher).await? - publisher_before,
        1_000,
        "publisher contract must receive exactly the escrow"
    );
    assert_eq!(
        payee_tasks(&publisher_c, &network).await?,
        0,
        "payee state touched"
    );
    let before_replay = near_balance(&network, &publisher).await?;
    expect_rejected(
        &contract,
        &network,
        &signer,
        &verifier,
        "refund_expired",
        json!({"task_id": "empty"}),
    )
    .await?;
    assert_eq!(near_balance(&network, &publisher).await?, before_replay);
    Ok(())
}
