// test_list_tasks_return_size.rs v1.1
// RED TEAM: list_tasks caps the task COUNT (100) but not the payload. A Sybil
// flood fills tasks with MAX_BIDS_PER_TASK commitments and bids using 64-char
// account ids; the JSON returned by list_tasks(0, 100) must stay under the
// protocol's max_length_returned_data (4 MiB), or the view fails and the web
// dashboard (TASKS_LIMIT = 100) goes blank. Found here: 100 full tasks were
// 16.5 MB; fixed by MAX_LIST_ENTRIES (short page, clients page with from += len).
use contract::{Bid, Commitment, Contract, MAX_BIDS_PER_TASK, MAX_LIST_ENTRIES, Task, TaskState};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, serde_json, testing_env};

const MAX_RETURNED_DATA: usize = 4 * 1024 * 1024;

fn long_account(i: usize) -> AccountId {
    let name = format!("{i:05}");
    let pad = "a".repeat(64 - name.len() - ".testnet".len());
    format!("{pad}{name}.testnet").parse().unwrap()
}

fn full_task(id: usize) -> Task {
    let accounts: Vec<AccountId> = (0..MAX_BIDS_PER_TASK).map(long_account).collect();
    Task {
        id: format!("{:064}", id),
        publisher: long_account(90_000),
        verifier: long_account(90_001),
        reward: NearToken::from_near(1),
        state: TaskState::Closed,
        commit_end: u64::MAX,
        reveal_end: u64::MAX,
        commitments: accounts
            .iter()
            .map(|w| Commitment { worker: w.clone(), hash: vec![255u8; 32] })
            .collect(),
        bids: accounts.iter().map(|w| Bid { worker: w.clone(), price: u64::MAX }).collect(),
        winner: Some(long_account(0)),
        result_hash: Some("f".repeat(128)),
    }
}

#[test]
fn list_tasks_payload_fits_in_returned_data_limit() {
    testing_env!(VMContextBuilder::new().build());
    let mut c = Contract::init(NearToken::from_near(100).as_yoctonear());
    for i in 0..100 {
        let t = full_task(i);
        c.tasks.insert(t.id.clone(), t);
    }
    let one = serde_json::to_vec(&c.list_tasks(0, 1)).unwrap().len();
    let tasks = c.list_tasks(0, 100);
    let page = serde_json::to_vec(&tasks).unwrap().len();
    assert_eq!(tasks.len(), MAX_LIST_ENTRIES / (2 * MAX_BIDS_PER_TASK));
    let mut seen = 0;
    while seen < 100 {
        let next = c.list_tasks(seen as u64, 100);
        assert!(!next.is_empty(), "pagination must always progress");
        assert_eq!(next[0].id, format!("{:064}", seen));
        seen += next.len();
    }
    assert_eq!(seen, 100);
    println!("list_tasks worst case: 1 task {one} B, page of {} tasks {page} B", tasks.len());
    println!("limit {MAX_RETURNED_DATA} B");
    assert!(
        page <= MAX_RETURNED_DATA,
        "list_tasks(0,100) returns {page} B > {MAX_RETURNED_DATA} B: view fails"
    );
}

#[test]
fn single_oversized_task_is_still_returned() {
    testing_env!(VMContextBuilder::new().build());
    let mut c = Contract::init(1_000);
    let t = full_task(0);
    c.tasks.insert(t.id.clone(), t);
    assert_eq!(c.list_tasks(0, 100).len(), 1);
}
