// lib.rs v0.1
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    AccountId, NearToken, PanicOnDefault, Promise, env, near, require, store::IterableMap,
};
use std::cmp::Ordering;

const REFUND_GRACE_BLOCKS: u64 = 100;
/// RULES.md 5: `list_tasks` returns at most 100 tasks per call (view gas cap),
/// independently of `cap_per_agent`.
const MAX_LIST_TASKS: usize = 100;

#[derive(
    Debug,
    Serialize,
    Deserialize,
    Clone,
    schemars::JsonSchema,
    near_sdk::borsh::BorshSerialize,
    near_sdk::borsh::BorshDeserialize,
)]
#[serde(crate = "near_sdk::serde")]
pub struct Bid {
    #[schemars(with = "String")]
    pub worker: AccountId,
    pub price: u64,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    Clone,
    schemars::JsonSchema,
    near_sdk::borsh::BorshSerialize,
    near_sdk::borsh::BorshDeserialize,
)]
#[serde(crate = "near_sdk::serde")]
pub struct Commitment {
    #[schemars(with = "String")]
    pub worker: AccountId,
    pub hash: Vec<u8>,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    Clone,
    schemars::JsonSchema,
    near_sdk::borsh::BorshSerialize,
    near_sdk::borsh::BorshDeserialize,
)]
#[serde(crate = "near_sdk::serde")]
pub struct Reputation {
    pub alpha: u64,
    pub beta: u64,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    Clone,
    schemars::JsonSchema,
    near_sdk::borsh::BorshSerialize,
    near_sdk::borsh::BorshDeserialize,
)]
#[serde(crate = "near_sdk::serde")]
pub struct Task {
    pub id: String,
    #[schemars(with = "String")]
    pub publisher: AccountId,
    #[schemars(with = "String")]
    pub verifier: AccountId,
    #[schemars(with = "String")]
    pub reward: NearToken,
    pub state: TaskState,
    pub commit_end: u64,
    pub reveal_end: u64,
    pub commitments: Vec<Commitment>,
    pub bids: Vec<Bid>,
    #[schemars(with = "Option<String>")]
    pub winner: Option<AccountId>,
    pub result_hash: Option<String>,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    Clone,
    PartialEq,
    schemars::JsonSchema,
    near_sdk::borsh::BorshSerialize,
    near_sdk::borsh::BorshDeserialize,
)]
#[serde(crate = "near_sdk::serde")]
pub enum TaskState {
    Open,
    Closed,
    Settled,
    Refunded,
}

#[derive(Debug, Serialize, Deserialize, Clone, schemars::JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub struct RoundView {
    pub task_id: String,
    pub commit_end: u64,
    pub reveal_end: u64,
    pub state: TaskState,
    pub bids: Vec<Bid>,
    #[schemars(with = "Option<String>")]
    pub winner: Option<AccountId>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub tasks: IterableMap<String, Task>,
    pub spent_by_agent: IterableMap<AccountId, u128>,
    pub workers: IterableMap<AccountId, bool>,
    pub reputations: IterableMap<AccountId, Reputation>,
    pub cap_per_agent: u128,
}

/// Max byte length of a task id stored in state (storage-griefing guard).
const MAX_ID_LEN: usize = 64;
/// Max byte length of a submitted result hash stored in state.
const MAX_RESULT_HASH_LEN: usize = 128;
/// Fixed safety margin the contract keeps free on top of its staked storage,
/// so a burst of spam rounds is rejected before it can freeze open escrows.
const STORAGE_RESERVE: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR

#[near]
impl Contract {
    #[init]
    pub fn init(cap_per_agent: u128) -> Self {
        Self {
            tasks: IterableMap::new(b"t"),
            spent_by_agent: IterableMap::new(b"s"),
            workers: IterableMap::new(b"w"),
            reputations: IterableMap::new(b"r"),
            cap_per_agent,
        }
    }

    #[payable]
    pub fn post_task(&mut self, id: String, verifier: AccountId, commit_len: u64, reveal_len: u64) {
        require!(
            !id.is_empty() && id.len() <= MAX_ID_LEN,
            "Task id length out of bounds"
        );
        require!(self.tasks.get(&id).is_none(), "Task ID already exists");
        require!(
            env::attached_deposit().as_yoctonear() > 0,
            "Reward must be > 0"
        );
        let commit_end = env::block_height()
            .checked_add(commit_len)
            .expect("Commit window overflow");
        let reveal_end = commit_end
            .checked_add(reveal_len)
            .expect("Reveal window overflow");

        let task = Task {
            id: id.clone(),
            publisher: env::predecessor_account_id(),
            verifier,
            reward: env::attached_deposit(),
            state: TaskState::Open,
            commit_end,
            reveal_end,
            commitments: Vec::new(),
            bids: Vec::new(),
            winner: None,
            result_hash: None,
        };
        self.tasks.insert(id, task);
        self.require_storage_reserve();
    }

    /// Storage-griefing guard (see tests/test_round_spam.rs): the contract's own
    /// funds (balance minus the escrows it still owes) must cover its staked
    /// storage plus a fixed reserve. Spam rounds grow staked storage faster than
    /// their 1-yocto escrows, so this rejects them before an honest payout can be
    /// frozen by `LackBalanceForState`. Does not change the state layout.
    fn require_storage_reserve(&self) {
        let staked = env::storage_byte_cost()
            .as_yoctonear()
            .saturating_mul(env::storage_usage() as u128);
        let liabilities: u128 = self
            .tasks
            .values()
            .filter(|task| matches!(task.state, TaskState::Open | TaskState::Closed))
            .map(|task| task.reward.as_yoctonear())
            .sum();
        let own_funds = env::account_balance().as_yoctonear().saturating_sub(liabilities);
        require!(
            own_funds >= staked.saturating_add(STORAGE_RESERVE),
            "Storage reserve exhausted: would risk freezing open escrows"
        );
    }

    pub fn register_worker(&mut self) {
        let worker = env::predecessor_account_id();
        require!(
            self.workers.get(&worker).is_none(),
            "Worker already registered"
        );
        self.workers.insert(worker, true);
    }

    pub fn commit_bid(&mut self, task_id: String, commitment: Vec<u8>) {
        let worker = env::predecessor_account_id();
        require!(
            self.workers.get(&worker).is_some(),
            "Worker is not registered"
        );
        require!(commitment.len() == 32, "Commitment must be a SHA-256 hash");

        let mut task = self.tasks.get(&task_id).cloned().expect("Task not found");
        require!(task.state == TaskState::Open, "Task is not open");
        require!(
            env::block_height() < task.commit_end,
            "Commit window is closed"
        );
        require!(
            !task.commitments.iter().any(|entry| entry.worker == worker),
            "Worker already committed"
        );
        task.commitments.push(Commitment {
            worker,
            hash: commitment,
        });
        self.tasks.insert(task_id, task);
    }

    pub fn reveal_bid(&mut self, task_id: String, price: u64, salt: u32) {
        let worker = env::predecessor_account_id();
        let mut task = self.tasks.get(&task_id).cloned().expect("Task not found");
        require!(task.state == TaskState::Open, "Task is not open");
        require!(
            env::block_height() >= task.commit_end && env::block_height() < task.reveal_end,
            "Reveal window is closed"
        );
        let commitment_index = task
            .commitments
            .iter()
            .position(|entry| entry.worker == worker)
            .expect("No commitment for worker");
        let mut payload = Vec::with_capacity(12 + worker.as_str().len());
        payload.extend_from_slice(&price.to_be_bytes());
        payload.extend_from_slice(&salt.to_be_bytes());
        payload.extend_from_slice(worker.as_str().as_bytes());
        require!(
            env::sha256(&payload) == task.commitments[commitment_index].hash,
            "Reveal does not match commitment"
        );
        task.commitments.remove(commitment_index);
        task.bids.push(Bid { worker, price });
        self.tasks.insert(task_id, task);
    }

    pub fn close_round(&mut self, task_id: String) {
        let mut task = self.tasks.get(&task_id).cloned().expect("Task not found");
        require!(task.state == TaskState::Open, "Task is not open");
        require!(
            env::block_height() >= task.reveal_end,
            "Reveal window is still open"
        );

        let mut best: Option<(Bid, u64, u64)> = None;
        for bid in task.bids.iter() {
            let reputation = self
                .reputations
                .get(&bid.worker)
                .cloned()
                .unwrap_or(Reputation { alpha: 1, beta: 1 });
            let total = reputation
                .alpha
                .checked_add(reputation.beta)
                .expect("Reputation overflow");
            if reputation.alpha == 0 {
                continue;
            }
            if let Some((current, current_alpha, current_total)) = &best {
                let candidate_num = u128::from(bid.price) * u128::from(total);
                let current_num = u128::from(current.price) * u128::from(*current_total);
                let score_order = compare_ratios(
                    candidate_num,
                    u128::from(reputation.alpha),
                    current_num,
                    u128::from(*current_alpha),
                );
                let tie_order = bid
                    .price
                    .cmp(&current.price)
                    .then_with(|| current_total.cmp(&total))
                    .then_with(|| current_alpha.cmp(&reputation.alpha))
                    .then_with(|| bid.worker.cmp(&current.worker));
                if score_order == Ordering::Less
                    || (score_order == Ordering::Equal && tie_order == Ordering::Less)
                {
                    best = Some((bid.clone(), reputation.alpha, total));
                }
            } else {
                best = Some((bid.clone(), reputation.alpha, total));
            }
        }
        task.winner = best.map(|(bid, _, _)| bid.worker);
        task.state = TaskState::Closed;
        self.tasks.insert(task_id, task);
    }
    pub fn submit_result(&mut self, task_id: String, result_hash: String) {
        let worker = env::predecessor_account_id();
        let mut task = self.tasks.get(&task_id).cloned().expect("Task not found");
        require!(task.state == TaskState::Closed, "Task is not closed");
        require!(
            task.winner.as_ref() == Some(&worker),
            "Only the winner can submit a result"
        );
        require!(task.result_hash.is_none(), "Result already submitted");
        require!(
            !result_hash.is_empty() && result_hash.len() <= MAX_RESULT_HASH_LEN,
            "Result hash length out of bounds"
        );
        task.result_hash = Some(result_hash);
        self.tasks.insert(task_id, task);
    }
    pub fn attest(&mut self, task_id: String, ok: bool) {
        let verifier = env::predecessor_account_id();
        let mut task = self.tasks.get(&task_id).cloned().expect("Task not found");
        require!(task.state == TaskState::Closed, "Task is not closed");
        require!(task.verifier == verifier, "Only the verifier can attest");
        require!(task.result_hash.is_some(), "Result has not been submitted");

        if ok {
            let winner = task.winner.clone().expect("Task has no winner");
            let spent = self.spent_by_agent.get(&winner).copied().unwrap_or(0);
            let amount = task.reward.as_yoctonear();
            let next_spent = spent.checked_add(amount);
            if next_spent.is_none_or(|total| total > self.cap_per_agent) {
                task.state = TaskState::Refunded;
                let publisher = task.publisher.clone();
                let reward = task.reward;
                self.tasks.insert(task_id, task);
                Promise::new(publisher).transfer(reward).detach();
                return;
            }

            let next_spent = next_spent.expect("Spend overflow");
            let mut reputation = self
                .reputations
                .get(&winner)
                .cloned()
                .unwrap_or(Reputation { alpha: 1, beta: 1 });
            reputation.alpha = reputation
                .alpha
                .checked_add(1)
                .expect("Reputation overflow");
            self.reputations.insert(winner.clone(), reputation);
            self.spent_by_agent.insert(winner.clone(), next_spent);
            task.state = TaskState::Settled;
            let reward = task.reward;
            self.tasks.insert(task_id, task);
            Promise::new(winner).transfer(reward).detach();
        } else {
            if let Some(winner) = task.winner.clone() {
                let mut reputation = self
                    .reputations
                    .get(&winner)
                    .cloned()
                    .unwrap_or(Reputation { alpha: 1, beta: 1 });
                reputation.beta = reputation.beta.checked_add(1).expect("Reputation overflow");
                self.reputations.insert(winner, reputation);
            }
            task.state = TaskState::Refunded;
            let publisher = task.publisher.clone();
            let reward = task.reward;
            self.tasks.insert(task_id, task);
            Promise::new(publisher).transfer(reward).detach();
        }
    }

    pub fn refund_expired(&mut self, task_id: String) {
        let mut task = self.tasks.get(&task_id).cloned().expect("Task not found");
        require!(task.state == TaskState::Closed, "Task is not closed");
        let refund_height = task
            .reveal_end
            .checked_add(REFUND_GRACE_BLOCKS)
            .expect("Refund height overflow");
        require!(
            env::block_height() >= refund_height,
            "Refund grace period has not elapsed"
        );

        if task.result_hash.is_none() {
            if let Some(winner) = task.winner.clone() {
                let mut reputation = self
                    .reputations
                    .get(&winner)
                    .cloned()
                    .unwrap_or(Reputation { alpha: 1, beta: 1 });
                reputation.beta = reputation.beta.checked_add(1).expect("Reputation overflow");
                self.reputations.insert(winner, reputation);
            }
        }
        task.state = TaskState::Refunded;
        let publisher = task.publisher.clone();
        let reward = task.reward;
        self.tasks.insert(task_id, task);
        Promise::new(publisher).transfer(reward).detach();
    }

    pub fn get_task(&self, task_id: String) -> Option<Task> {
        self.tasks.get(&task_id).cloned()
    }

    pub fn list_tasks(&self, from: u64, limit: u64) -> Vec<Task> {
        let from = usize::try_from(from).unwrap_or(usize::MAX);
        let limit = usize::try_from(limit).unwrap_or(usize::MAX);
        let effective_limit = limit.min(MAX_LIST_TASKS);

        self.tasks
            .iter()
            .skip(from)
            .take(effective_limit)
            .map(|(_, task)| task.clone())
            .collect()
    }

    pub fn get_round(&self, task_id: String) -> Option<RoundView> {
        self.tasks.get(&task_id).map(|task| RoundView {
            task_id: task.id.clone(),
            commit_end: task.commit_end,
            reveal_end: task.reveal_end,
            state: task.state.clone(),
            bids: task.bids.clone(),
            winner: task.winner.clone(),
        })
    }

    pub fn get_reputation(&self, account: AccountId) -> (String, String, String) {
        let reputation = self
            .reputations
            .get(&account)
            .cloned()
            .unwrap_or(Reputation { alpha: 1, beta: 1 });
        let mean = reputation.alpha as f64 / (reputation.alpha as f64 + reputation.beta as f64);
        (
            reputation.alpha.to_string(),
            reputation.beta.to_string(),
            mean.to_string(),
        )
    }

    pub fn get_config(&self) -> (String, u64) {
        (self.cap_per_agent.to_string(), u64::from(self.tasks.len()))
    }
}
fn compare_ratios(
    mut left_num: u128,
    mut left_den: u128,
    mut right_num: u128,
    mut right_den: u128,
) -> Ordering {
    let mut reversed = false;
    loop {
        let quotient_order = (left_num / left_den).cmp(&(right_num / right_den));
        if quotient_order != Ordering::Equal {
            return if reversed {
                quotient_order.reverse()
            } else {
                quotient_order
            };
        }
        let left_rem = left_num % left_den;
        let right_rem = right_num % right_den;
        match (left_rem == 0, right_rem == 0) {
            (true, true) => return Ordering::Equal,
            (true, false) => {
                return if reversed {
                    Ordering::Greater
                } else {
                    Ordering::Less
                };
            }
            (false, true) => {
                return if reversed {
                    Ordering::Less
                } else {
                    Ordering::Greater
                };
            }
            (false, false) => {
                left_num = left_den;
                left_den = left_rem;
                right_num = right_den;
                right_den = right_rem;
                reversed = !reversed;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Contract, Reputation, Task, TaskState, compare_ratios};
    use near_sdk::{AccountId, NearToken, test_utils::VMContextBuilder, testing_env};
    use std::panic::{AssertUnwindSafe, catch_unwind};

    fn set_context(predecessor: &str, block_height: u64, deposit: u128) {
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(predecessor.parse().unwrap())
                .block_height(block_height)
                .attached_deposit(NearToken::from_yoctonear(deposit))
                .build()
        );
    }

    fn bid_commitment(worker: &near_sdk::AccountId, price: u64, salt: u32) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.extend_from_slice(&price.to_be_bytes());
        payload.extend_from_slice(&salt.to_be_bytes());
        payload.extend_from_slice(worker.as_str().as_bytes());
        near_sdk::env::sha256(&payload)
    }

    fn closed_task(winner: Option<AccountId>, result_hash: Option<String>) -> Task {
        Task {
            id: "task-1".to_string(),
            publisher: "publisher.testnet".parse().unwrap(),
            verifier: "verifier.testnet".parse().unwrap(),
            reward: NearToken::from_yoctonear(100),
            state: TaskState::Closed,
            commit_end: 1,
            reveal_end: 2,
            commitments: Vec::new(),
            bids: Vec::new(),
            winner,
            result_hash,
        }
    }

    #[test]
    fn registered_worker_can_reveal_and_close_round() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );

        set_context(worker.as_str(), 2, 0);
        contract.register_worker();
        let price = 7u64;
        let salt = 9u32;
        set_context("worker.testnet", 3, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, price, salt));
        set_context("worker.testnet", 11, 0);
        contract.reveal_bid("task-1".to_string(), price, salt);
        set_context("publisher.testnet", 21, 0);
        contract.close_round("task-1".to_string());

        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.state, super::TaskState::Closed);
        assert_eq!(task.winner.as_ref(), Some(&worker));
    }

    #[test]
    fn rejects_a_second_commit_from_the_same_worker() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        set_context(worker.as_str(), 2, 0);
        contract.register_worker();
        set_context("worker.testnet", 3, 0);
        let first = bid_commitment(&worker, 7, 9);
        contract.commit_bid("task-1".to_string(), first.clone());

        let duplicate = catch_unwind(AssertUnwindSafe(|| {
            contract.commit_bid("task-1".to_string(), bid_commitment(&worker, 8, 10));
        }));
        assert!(duplicate.is_err());
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.commitments.len(), 1);
        assert_eq!(task.commitments[0].hash, first);
    }

    #[test]
    fn only_committing_worker_can_reveal_a_bid() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );

        for account in ["worker.testnet", "other.testnet"] {
            set_context(account, 2, 0);
            contract.register_worker();
        }
        set_context("worker.testnet", 3, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, 7, 9));

        set_context("other.testnet", 11, 0);
        let unauthorized = catch_unwind(AssertUnwindSafe(|| {
            contract.reveal_bid("task-1".to_string(), 7, 9);
        }));
        assert!(unauthorized.is_err());
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert!(task.bids.is_empty());
        assert_eq!(task.commitments.len(), 1);

        set_context("worker.testnet", 11, 0);
        contract.reveal_bid("task-1".to_string(), 7, 9);
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.bids.len(), 1);
        assert!(task.commitments.is_empty());
    }

    #[test]
    fn rejects_reveal_that_does_not_match_commitment() {
        let worker: near_sdk::AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        set_context(worker.as_str(), 2, 0);
        contract.register_worker();
        set_context("worker.testnet", 3, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, 7, 9));

        set_context("worker.testnet", 11, 0);
        let mismatch = catch_unwind(AssertUnwindSafe(|| {
            contract.reveal_bid("task-1".to_string(), 8, 9);
        }));
        assert!(mismatch.is_err());
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert!(task.bids.is_empty());
        assert_eq!(task.commitments.len(), 1);
    }

    #[test]
    fn rejects_commit_and_reveal_outside_their_windows() {
        let worker: near_sdk::AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        set_context(worker.as_str(), 2, 0);
        contract.register_worker();

        set_context("worker.testnet", 11, 0);
        let late_commit = catch_unwind(AssertUnwindSafe(|| {
            contract.commit_bid("task-1".to_string(), vec![0; 32]);
        }));
        assert!(late_commit.is_err());

        set_context("worker.testnet", 10, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, 7, 9));
        set_context("worker.testnet", 10, 0);
        let early_reveal = catch_unwind(AssertUnwindSafe(|| {
            contract.reveal_bid("task-1".to_string(), 7, 9);
        }));
        assert!(early_reveal.is_err());
        set_context("worker.testnet", 21, 0);
        let late_reveal = catch_unwind(AssertUnwindSafe(|| {
            contract.reveal_bid("task-1".to_string(), 7, 9);
        }));
        assert!(late_reveal.is_err());
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert!(task.bids.is_empty());
        assert_eq!(task.commitments.len(), 1);
    }

    #[test]
    fn reveal_is_accepted_at_commit_end() {
        let worker: near_sdk::AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        set_context(worker.as_str(), 2, 0);
        contract.register_worker();
        set_context("worker.testnet", 10, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, 7, 9));

        set_context("worker.testnet", 11, 0);
        contract.reveal_bid("task-1".to_string(), 7, 9);

        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.bids.len(), 1);
        assert!(task.commitments.is_empty());
    }

    #[test]
    fn empty_round_closes_without_a_winner() {
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );

        set_context("publisher.testnet", 21, 0);
        contract.close_round("task-1".to_string());
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.state, TaskState::Closed);
        assert!(task.winner.is_none());
    }

    #[test]
    fn equal_bids_are_won_by_lexicographically_first_account() {
        let mut contract = Contract::init(1_000);
        set_context("publisher.testnet", 1, 100);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );

        for worker in ["z-worker.testnet", "a-worker.testnet"] {
            set_context(worker, 2, 0);
            contract.register_worker();
            set_context(worker, 3, 0);
            let account: near_sdk::AccountId = worker.parse().unwrap();
            contract.commit_bid("task-1".to_string(), bid_commitment(&account, 7, 9));
        }
        for worker in ["z-worker.testnet", "a-worker.testnet"] {
            set_context(worker, 11, 0);
            contract.reveal_bid("task-1".to_string(), 7, 9);
        }

        set_context("publisher.testnet", 21, 0);
        contract.close_round("task-1".to_string());
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.winner.as_ref().unwrap().as_str(), "a-worker.testnet");
    }

    #[test]
    fn lower_nominal_price_wins_an_exact_adjusted_price_tie() {
        let low_price: AccountId = "z-worker.testnet".parse().unwrap();
        let lower_name: AccountId = "a-worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        contract
            .reputations
            .insert(low_price.clone(), Reputation { alpha: 1, beta: 1 });
        contract
            .reputations
            .insert(lower_name.clone(), Reputation { alpha: 3, beta: 1 });

        for worker in [&low_price, &lower_name] {
            set_context(worker.as_str(), 2, 0);
            contract.register_worker();
        }
        set_context(low_price.as_str(), 3, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&low_price, 10, 9));
        set_context(lower_name.as_str(), 4, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&lower_name, 15, 10));

        set_context(low_price.as_str(), 11, 0);
        contract.reveal_bid("task-1".to_string(), 10, 9);
        set_context(lower_name.as_str(), 11, 0);
        contract.reveal_bid("task-1".to_string(), 15, 10);
        set_context("publisher.testnet", 21, 0);
        contract.close_round("task-1".to_string());

        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.winner.as_ref(), Some(&low_price));
    }

    #[test]
    fn post_task_rejects_duplicate_id() {
        let publisher: AccountId = "publisher.testnet".parse().unwrap();
        let verifier: AccountId = "verifier.testnet".parse().unwrap();
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(publisher)
                .attached_deposit(NearToken::from_yoctonear(1))
                .build()
        );
        let mut contract = Contract::init(0);
        contract.post_task("task-1".to_string(), verifier.clone(), 10, 10);
        let duplicate = catch_unwind(AssertUnwindSafe(|| {
            contract.post_task("task-1".to_string(), verifier, 10, 10);
        }));
        assert!(
            duplicate.is_err(),
            "duplicate task IDs must not overwrite escrow"
        );
    }

    #[test]
    fn post_task_rejects_overflowing_windows() {
        let verifier: AccountId = "verifier.testnet".parse().unwrap();
        let mut contract = Contract::init(0);

        set_context("publisher.testnet", u64::MAX - 1, 1);
        let commit_overflow = catch_unwind(AssertUnwindSafe(|| {
            contract.post_task("commit-overflow".to_string(), verifier.clone(), 2, 1);
        }));
        assert!(commit_overflow.is_err());

        set_context("publisher.testnet", u64::MAX - 3, 1);
        let reveal_overflow = catch_unwind(AssertUnwindSafe(|| {
            contract.post_task("reveal-overflow".to_string(), verifier, 1, 3);
        }));
        assert!(reveal_overflow.is_err());
    }

    #[test]
    fn only_winner_can_submit_result_once() {
        let mut contract = Contract::init(1_000);
        contract.tasks.insert(
            "task-1".to_string(),
            Task {
                id: "task-1".to_string(),
                publisher: "publisher.testnet".parse().unwrap(),
                verifier: "verifier.testnet".parse().unwrap(),
                reward: NearToken::from_yoctonear(100),
                state: TaskState::Closed,
                commit_end: 1,
                reveal_end: 2,
                commitments: Vec::new(),
                bids: Vec::new(),
                winner: Some("worker.testnet".parse().unwrap()),
                result_hash: None,
            },
        );

        set_context("other.testnet", 3, 0);
        let unauthorized = catch_unwind(AssertUnwindSafe(|| {
            contract.submit_result("task-1".to_string(), "hash".to_string());
        }));
        assert!(unauthorized.is_err());

        set_context("worker.testnet", 3, 0);
        contract.submit_result("task-1".to_string(), "hash".to_string());
        assert_eq!(
            contract
                .tasks
                .get(&"task-1".to_string())
                .unwrap()
                .result_hash
                .as_deref(),
            Some("hash")
        );
        let duplicate = catch_unwind(AssertUnwindSafe(|| {
            contract.submit_result("task-1".to_string(), "hash-2".to_string());
        }));
        assert!(duplicate.is_err());
    }

    #[test]
    fn verifier_attestation_settles_once_and_updates_reputation() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        let mut contract = Contract::init(1_000);
        contract.tasks.insert(
            "task-1".to_string(),
            closed_task(Some(worker.clone()), Some("result-hash".to_string())),
        );
        set_context("other.testnet", 20, 0);
        let unauthorized = catch_unwind(AssertUnwindSafe(|| {
            contract.attest("task-1".to_string(), true);
        }));
        assert!(unauthorized.is_err());

        set_context("verifier.testnet", 20, 0);
        contract.attest("task-1".to_string(), true);
        assert_eq!(
            contract.tasks.get(&"task-1".to_string()).unwrap().state,
            TaskState::Settled
        );
        assert_eq!(contract.spent_by_agent.get(&worker), Some(&100));
        assert_eq!(contract.reputations.get(&worker).unwrap().alpha, 2);

        let duplicate = catch_unwind(AssertUnwindSafe(|| {
            contract.attest("task-1".to_string(), true);
        }));
        assert!(duplicate.is_err());
    }

    #[test]
    fn failed_attestation_refunds_and_lowers_reputation() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        let mut contract = Contract::init(1_000);
        contract.tasks.insert(
            "task-1".to_string(),
            closed_task(Some(worker.clone()), Some("result-hash".to_string())),
        );
        set_context("verifier.testnet", 20, 0);
        contract.attest("task-1".to_string(), false);
        assert_eq!(
            contract.tasks.get(&"task-1".to_string()).unwrap().state,
            TaskState::Refunded
        );
        assert_eq!(contract.reputations.get(&worker).unwrap().beta, 2);

        let duplicate = catch_unwind(AssertUnwindSafe(|| {
            contract.attest("task-1".to_string(), false);
        }));
        assert!(duplicate.is_err());
        assert_eq!(contract.reputations.get(&worker).unwrap().beta, 2);
    }

    #[test]
    fn expired_refund_requires_grace_and_penalizes_missing_result() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        let mut contract = Contract::init(1_000);
        contract.tasks.insert(
            "task-1".to_string(),
            closed_task(Some(worker.clone()), None),
        );
        set_context("caller.testnet", 101, 0);
        let early = catch_unwind(AssertUnwindSafe(|| {
            contract.refund_expired("task-1".to_string());
        }));
        assert!(early.is_err());

        set_context("caller.testnet", 102, 0);
        contract.refund_expired("task-1".to_string());
        assert_eq!(
            contract.tasks.get(&"task-1".to_string()).unwrap().state,
            TaskState::Refunded
        );
        assert_eq!(contract.reputations.get(&worker).unwrap().beta, 2);
    }

    #[test]
    fn expired_refund_without_winner_does_not_change_reputation() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        let mut contract = Contract::init(1_000);
        contract
            .tasks
            .insert("task-1".to_string(), closed_task(None, None));
        set_context("caller.testnet", 102, 0);

        contract.refund_expired("task-1".to_string());

        assert_eq!(
            contract.tasks.get(&"task-1".to_string()).unwrap().state,
            TaskState::Refunded
        );
        assert!(contract.reputations.get(&worker).is_none());
    }

    #[test]
    fn expired_refund_after_result_preserves_reputation() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        let mut contract = Contract::init(1_000);
        contract.tasks.insert(
            "task-1".to_string(),
            closed_task(Some(worker.clone()), Some("result-hash".to_string())),
        );
        contract
            .reputations
            .insert(worker.clone(), Reputation { alpha: 3, beta: 4 });
        set_context("caller.testnet", 102, 0);

        contract.refund_expired("task-1".to_string());

        assert_eq!(
            contract.tasks.get(&"task-1".to_string()).unwrap().state,
            TaskState::Refunded
        );
        let reputation = contract.reputations.get(&worker).unwrap();
        assert_eq!(reputation.alpha, 3);
        assert_eq!(reputation.beta, 4);
    }

    #[test]
    fn expired_refund_cannot_be_applied_twice() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        let mut contract = Contract::init(1_000);
        contract.tasks.insert(
            "task-1".to_string(),
            closed_task(Some(worker.clone()), None),
        );
        set_context("caller.testnet", 102, 0);

        contract.refund_expired("task-1".to_string());
        let duplicate = catch_unwind(AssertUnwindSafe(|| {
            contract.refund_expired("task-1".to_string());
        }));

        assert!(duplicate.is_err());
        assert_eq!(
            contract.tasks.get(&"task-1".to_string()).unwrap().state,
            TaskState::Refunded
        );
        assert_eq!(contract.reputations.get(&worker).unwrap().beta, 2);
    }

    #[test]
    fn cap_exceeded_refunds_instead_of_paying() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        let mut contract = Contract::init(99);
        contract.tasks.insert(
            "task-1".to_string(),
            closed_task(Some(worker.clone()), Some("result-hash".to_string())),
        );
        set_context("verifier.testnet", 20, 0);
        contract.attest("task-1".to_string(), true);
        assert_eq!(
            contract.tasks.get(&"task-1".to_string()).unwrap().state,
            TaskState::Refunded
        );
        assert_eq!(contract.spent_by_agent.get(&worker), None);
        assert!(contract.reputations.get(&worker).is_none());
    }

    #[test]
    fn views_return_tasks_round_and_beta_reputation() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        let mut contract = Contract::init(100);
        let mut task = closed_task(Some(worker.clone()), None);
        task.bids.push(super::Bid {
            worker: worker.clone(),
            price: 7,
        });
        contract.tasks.insert("task-1".to_string(), task);
        contract
            .reputations
            .insert(worker.clone(), Reputation { alpha: 3, beta: 2 });

        assert!(contract.get_task("missing".to_string()).is_none());
        assert_eq!(
            contract.get_task("task-1".to_string()).unwrap().winner,
            Some(worker.clone())
        );
        assert_eq!(contract.list_tasks(0, 1).len(), 1);
        assert!(contract.list_tasks(1, 1).is_empty());

        let round = contract.get_round("task-1".to_string()).unwrap();
        assert_eq!(round.commit_end, 1);
        assert_eq!(round.reveal_end, 2);
        assert_eq!(round.bids.len(), 1);
        assert_eq!(round.winner, Some(worker.clone()));
        assert_eq!(
            contract.get_reputation(worker),
            ("3".to_string(), "2".to_string(), "0.6".to_string())
        );
        assert_eq!(
            contract.get_reputation("new-worker.testnet".parse().unwrap()),
            ("1".to_string(), "1".to_string(), "0.5".to_string())
        );
        assert_eq!(contract.get_config(), ("100".to_string(), 1));
    }
    // Gap tests for R1, R5 and R7 (this round).
    #[test]
    fn post_task_rejects_zero_deposit() {
        let verifier: AccountId = "verifier.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 0);
        let mut contract = Contract::init(1_000);
        let zero_deposit = catch_unwind(AssertUnwindSafe(|| {
            contract.post_task("task-1".to_string(), verifier, 10, 10);
        }));
        assert!(zero_deposit.is_err(), "escrow cannot be empty");
        assert!(contract.tasks.get(&"task-1".to_string()).is_none());
    }

    #[test]
    fn unregistered_worker_cannot_commit() {
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        let stranger: AccountId = "stranger.testnet".parse().unwrap();
        set_context("stranger.testnet", 3, 0);
        let commit = catch_unwind(AssertUnwindSafe(|| {
            contract.commit_bid("task-1".to_string(), bid_commitment(&stranger, 7, 9));
        }));
        assert!(commit.is_err(), "only registered workers may commit");
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert!(task.commitments.is_empty());
    }

    #[test]
    fn reputation_beats_a_lower_nominal_price() {
        let cheap: AccountId = "a-worker.testnet".parse().unwrap();
        let trusted: AccountId = "b-worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 500);
        let mut contract = Contract::init(10_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            5,
            5,
        );

        set_context("a-worker.testnet", 2, 0);
        contract.register_worker();
        set_context("b-worker.testnet", 2, 0);
        contract.register_worker();
        contract
            .reputations
            .insert(trusted.clone(), Reputation { alpha: 9, beta: 1 });

        set_context("a-worker.testnet", 3, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&cheap, 100, 1));
        set_context("b-worker.testnet", 4, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&trusted, 150, 2));

        set_context("a-worker.testnet", 7, 0);
        contract.reveal_bid("task-1".to_string(), 100, 1);
        set_context("b-worker.testnet", 7, 0);
        contract.reveal_bid("task-1".to_string(), 150, 2);

        set_context("publisher.testnet", 12, 0);
        contract.close_round("task-1".to_string());

        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        // adjusted price: 150 * 10/9 = 166 beats 100 * 2/1 = 200.
        assert_eq!(
            task.winner.as_ref(),
            Some(&trusted),
            "better reputation must win a higher nominal price"
        );
    }

    #[test]
    fn exact_ratio_comparison_handles_near_maximum_values() {
        let denominator = u128::from(u64::MAX);
        assert_eq!(
            compare_ratios(u128::MAX - 1, denominator, u128::MAX - 2, denominator,),
            std::cmp::Ordering::Greater
        );
    }

    #[test]
    fn rejects_commitments_that_are_not_sha256_hashes() {
        let worker: near_sdk::AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        set_context(worker.as_str(), 2, 0);
        contract.register_worker();

        for len in [31usize, 33, 0] {
            let hash = vec![0u8; len];
            let rejected = catch_unwind(AssertUnwindSafe(|| {
                contract.commit_bid("task-1".to_string(), hash.clone());
            }));
            assert!(
                rejected.is_err(),
                "commitment of {} bytes must be rejected",
                len
            );
        }

        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert!(task.commitments.is_empty());
    }

    #[test]
    fn zero_length_windows_block_commits_and_reveals() {
        let worker: near_sdk::AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-zero-commit".to_string(),
            "verifier.testnet".parse().unwrap(),
            0,
            10,
        );
        set_context("worker.testnet", 1, 0);
        contract.register_worker();

        set_context("worker.testnet", 1, 0);
        let commit = catch_unwind(AssertUnwindSafe(|| {
            contract.commit_bid(
                "task-zero-commit".to_string(),
                bid_commitment(&worker, 7, 9),
            );
        }));
        assert!(commit.is_err(), "commit_len = 0 must forbid committing");

        set_context("publisher.testnet", 20, 100);
        contract.post_task(
            "task-zero-reveal".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            0,
        );
        set_context("worker.testnet", 21, 0);
        contract.commit_bid(
            "task-zero-reveal".to_string(),
            bid_commitment(&worker, 7, 9),
        );
        set_context("worker.testnet", 30, 0);
        let reveal = catch_unwind(AssertUnwindSafe(|| {
            contract.reveal_bid("task-zero-reveal".to_string(), 7, 9);
        }));
        assert!(reveal.is_err(), "reveal_len = 0 must forbid revealing");

        let zero_commit = contract.tasks.get(&"task-zero-commit".to_string()).unwrap();
        assert!(zero_commit.commitments.is_empty());
        let zero_reveal = contract.tasks.get(&"task-zero-reveal".to_string()).unwrap();
        assert_eq!(zero_reveal.commitments.len(), 1);
        assert!(zero_reveal.bids.is_empty());
    }

    #[test]
    fn a_revealed_commitment_cannot_be_revealed_twice() {
        let worker: near_sdk::AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        set_context(worker.as_str(), 2, 0);
        contract.register_worker();
        set_context("worker.testnet", 3, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, 7, 9));
        set_context("worker.testnet", 11, 0);
        contract.reveal_bid("task-1".to_string(), 7, 9);
        set_context("worker.testnet", 12, 0);
        let second = catch_unwind(AssertUnwindSafe(|| {
            contract.reveal_bid("task-1".to_string(), 7, 9);
        }));
        assert!(second.is_err(), "a commitment can only be revealed once");

        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.bids.len(), 1);
    }

    // src/lib.rs v1.4 · added test
    #[test]
    fn cap_boundary_pays_up_to_limit_and_refunds_when_payment_exceeds_remaining() {
        let worker: AccountId = "worker.testnet".parse().unwrap();

        // RULES.md:33 the cap bounds cumulative spend; paying exactly up to the
        // remaining limit still settles (spent 400 + reward 100 == cap 500).
        let mut contract = Contract::init(500);
        contract.spent_by_agent.insert(worker.clone(), 400);
        let mut exact = closed_task(Some(worker.clone()), Some("rh".to_string()));
        exact.reward = NearToken::from_yoctonear(100);
        contract.tasks.insert("exact".to_string(), exact);
        set_context("verifier.testnet", 20, 0);
        contract.attest("exact".to_string(), true);
        assert_eq!(
            contract.tasks.get(&"exact".to_string()).unwrap().state,
            TaskState::Settled
        );
        assert_eq!(contract.spent_by_agent.get(&worker), Some(&500));
        assert_eq!(contract.reputations.get(&worker).unwrap().alpha, 2);

        // spent 450 + reward 100 == 550 > cap 500 => refund, no pay, no rep.
        let mut contract = Contract::init(500);
        contract.spent_by_agent.insert(worker.clone(), 450);
        let mut over = closed_task(Some(worker.clone()), Some("rh".to_string()));
        over.reward = NearToken::from_yoctonear(100);
        contract.tasks.insert("over".to_string(), over);
        set_context("verifier.testnet", 20, 0);
        contract.attest("over".to_string(), true);
        assert_eq!(
            contract.tasks.get(&"over".to_string()).unwrap().state,
            TaskState::Refunded
        );
        assert_eq!(contract.spent_by_agent.get(&worker), Some(&450));
        assert!(contract.reputations.get(&worker).is_none());
    }

    // Gap tests for RULES.md v1.3 after the 19:50 juez cribado: open permissions and escrow conservation.
    #[test]
    fn any_account_can_close_a_round() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        set_context("worker.testnet", 11, 0);
        contract.register_worker();
        set_context("worker.testnet", 3, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, 7, 9));
        set_context("worker.testnet", 12, 0);
        contract.reveal_bid("task-1".to_string(), 7, 9);

        set_context("stranger.testnet", 21, 0);
        contract.close_round("task-1".to_string());
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.state, TaskState::Closed);
        assert_eq!(task.winner, Some(worker));
    }

    #[test]
    fn submit_result_requires_a_closed_round_won_by_the_caller() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        set_context("worker.testnet", 11, 0);
        contract.register_worker();
        set_context("worker.testnet", 3, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, 7, 9));
        set_context("worker.testnet", 12, 0);
        contract.reveal_bid("task-1".to_string(), 7, 9);

        set_context("worker.testnet", 15, 0);
        let before_close = catch_unwind(AssertUnwindSafe(|| {
            contract.submit_result("task-1".to_string(), "hash".to_string());
        }));
        assert!(
            before_close.is_err(),
            "submit before close_round must panic"
        );

        set_context("publisher.testnet", 21, 0);
        contract.close_round("task-1".to_string());
        set_context("other.testnet", 22, 0);
        let intruder = catch_unwind(AssertUnwindSafe(|| {
            contract.submit_result("task-1".to_string(), "hash".to_string());
        }));
        assert!(
            intruder.is_err(),
            "only the round winner may submit a result"
        );

        set_context("worker.testnet", 22, 0);
        contract.submit_result("task-1".to_string(), "hash".to_string());
        let task = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(task.result_hash.as_deref(), Some("hash"));
    }

    #[test]
    fn settlements_and_refunds_conserve_the_escrow() {
        let worker_a: AccountId = "a.testnet".parse().unwrap();
        let worker_b: AccountId = "b.testnet".parse().unwrap();
        let mut contract = Contract::init(5_000);

        let mut settled = closed_task(Some(worker_a.clone()), Some("rh".to_string()));
        settled.reward = NearToken::from_yoctonear(300);
        contract.tasks.insert("settled".to_string(), settled);

        let mut failed = closed_task(Some(worker_a.clone()), Some("rh".to_string()));
        failed.reward = NearToken::from_yoctonear(200);
        contract.tasks.insert("failed".to_string(), failed);

        let mut capped = closed_task(Some(worker_b.clone()), Some("rh".to_string()));
        capped.reward = NearToken::from_yoctonear(4_000);
        contract.tasks.insert("capped".to_string(), capped);
        contract.spent_by_agent.insert(worker_b.clone(), 3_000);

        set_context("verifier.testnet", 20, 0);
        contract.attest("settled".to_string(), true);
        contract.attest("failed".to_string(), false);
        contract.attest("capped".to_string(), true);

        let mut paid: u128 = 0;
        let mut refunded: u128 = 0;
        for id in ["settled", "failed", "capped"] {
            let task = contract.tasks.get(&id.to_string()).unwrap();
            match task.state {
                TaskState::Settled => paid += task.reward.as_yoctonear(),
                TaskState::Refunded => refunded += task.reward.as_yoctonear(),
                _ => panic!("task {id} left unfinished"),
            }
            let again = catch_unwind(AssertUnwindSafe(|| {
                contract.attest(id.to_string(), true);
            }));
            assert!(again.is_err(), "task {id} was attested twice");
        }

        assert_eq!(paid, 300, "only the settled escrow leaves the contract");
        assert_eq!(
            refunded, 4_200,
            "failed and capped escrows go back to the publisher"
        );
        assert_eq!(
            paid + refunded,
            4_500,
            "every yoctoNEAR of escrow is either paid or refunded"
        );
        assert_eq!(contract.spent_by_agent.get(&worker_a), Some(&300));
        assert_eq!(contract.spent_by_agent.get(&worker_b), Some(&3_000));
        assert!(contract.spent_by_agent.get(&worker_a).unwrap_or(&0) <= &contract.cap_per_agent);
        assert!(contract.spent_by_agent.get(&worker_b).unwrap_or(&0) <= &contract.cap_per_agent);
        assert_eq!(contract.reputations.get(&worker_a).unwrap().alpha, 2);
        assert_eq!(contract.reputations.get(&worker_a).unwrap().beta, 2);
    }

    #[test]
    fn list_tasks_caps_the_limit_to_100() {
        // tope de gasto realista en yoctoNEAR (5.000 NEAR): el limite de la vista
        // debe seguir siendo 100 (RULES.md 5) y no el tope de gasto.
        let mut contract = Contract::init(5_000_000_000_000_000_000_000_000_000);
        for index in 0..150 {
            contract
                .tasks
                .insert(format!("task-{index}"), closed_task(None, None));
        }

        assert_eq!(contract.list_tasks(0, u64::MAX).len(), 100);
        assert_eq!(contract.list_tasks(0, 1_000).len(), 100);
        assert_eq!(contract.list_tasks(0, 10).len(), 10);
        assert_eq!(contract.list_tasks(140, 10).len(), 10);
    }
    #[test]
    fn reputation_beta_invariant_across_mixed_outcomes() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        let mut contract = Contract::init(1_000);

        // 5 tareas cerradas ganadas por el mismo worker, resultados mixtos.
        // Esperado: Beta(1+3 exitosos, 1+2 fracasos) = Beta(4, 3).
        let outcomes = [
            ("t1", true),
            ("t2", false),
            ("t3", true),
            ("t4", true),
            ("t5", false),
        ];
        for (id, ok) in outcomes {
            contract.tasks.insert(
                id.to_string(),
                Task {
                    id: id.to_string(),
                    publisher: "publisher.testnet".parse().unwrap(),
                    verifier: "verifier.testnet".parse().unwrap(),
                    reward: NearToken::from_yoctonear(100),
                    state: TaskState::Closed,
                    commit_end: 1,
                    reveal_end: 2,
                    commitments: Vec::new(),
                    bids: Vec::new(),
                    winner: Some(worker.clone()),
                    result_hash: Some(format!("rh-{id}")),
                },
            );
            set_context("verifier.testnet", 20, 0);
            contract.attest(id.to_string(), ok);
        }

        let rep = contract.reputations.get(&worker).unwrap();
        assert_eq!(rep.alpha, 4, "alpha = 1 + 3 exitosos");
        assert_eq!(rep.beta, 3, "beta = 1 + 2 fracasos");

        // Vista get_reputation reproduce el mismo Beta.
        let (alpha_s, beta_s, mean_s) = contract.get_reputation(worker.clone());
        assert_eq!(alpha_s, "4");
        assert_eq!(beta_s, "3");
        let mean: f64 = mean_s.parse().unwrap();
        assert!(
            (mean - 4.0 / 7.0).abs() < 1e-9,
            "mean = alpha/(alpha+beta) = 4/7"
        );
    }

    #[test]
    fn commitment_formula_matches_known_answer_vectors() {
        // KAT: bid_commitment must equal an independently computed SHA-256 of
        // price_be_u64 || salt_be_u32 || account_utf8 (canonical layout of
        // RULES.md commit = sha256(precio||sal||cuenta)). Pins the wire
        // serialization: any change to field order, endianness or salt width
        // breaks this vector.
        let hex = |digest: &[u8]| -> String { digest.iter().map(|b| format!("{b:02x}")).collect() };
        let check = |price: u64, salt: u32, account: &str, expected: &str| {
            let account: near_sdk::AccountId = account.parse().unwrap();
            let digest = bid_commitment(&account, price, salt);
            assert_eq!(digest.len(), 32, "commitment must be a 32-byte SHA-256");
            assert_eq!(hex(&digest), expected);
        };
        check(
            80,
            9,
            "worker.test.near",
            "1d55fb5286698a8cbea17d9a556cb9ba7ffaae183674d09811cd8f0ee47b7c62",
        );
        check(
            7,
            9,
            "worker.test.near",
            "22e0aadb4f4b716a26a85b077c8aa7165db4ba7308d240ba6cb69d40e508726c",
        );
        check(
            1_000_000_000,
            42,
            "alice.near",
            "eef7ad16ec04f9c4e71b37cba6fbd38de180abfc8f793f687e2eabcaf2ba4384",
        );
        check(
            0,
            0,
            "a.test.near",
            "85bbdf556b9f8964433345b72b307b0dcd0f32594f53ba14f549120caf0b3d76",
        );
    }

    /// Recorrido de 30 rondas con PRNG sembrado (xorshift64*, sin crates extra) que
    /// mezcla liquidacion, atestacion fallida, reembolsos por gracia, tope de gasto
    /// agotado y rondas sin pujas. Comprueba las invariantes de RULES.md 3 y 4:
    /// conservacion del escrow, tope de gasto y reputacion Beta.
    #[test]
    fn seeded_schedule_conserves_escrow_and_reputation() {
        let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut rand = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state.wrapping_mul(0x2545_F491_4F6C_DD1D)
        };

        let verifier: AccountId = "verifier.testnet".parse().unwrap();
        let workers: Vec<AccountId> = ["w0.testnet", "w1.testnet", "w2.testnet", "w3.testnet"]
            .iter()
            .map(|name| name.parse().unwrap())
            .collect();
        let cap: u128 = 5_000;
        let mut contract = Contract::init(cap);
        for worker in &workers {
            set_context(worker.as_str(), 0, 0);
            contract.register_worker();
        }

        let mut escrow: u128 = 0;
        let mut paid: u128 = 0;
        let mut refunded: u128 = 0;
        let mut alpha_delta = std::collections::BTreeMap::<AccountId, u64>::new();
        let mut beta_delta = std::collections::BTreeMap::<AccountId, u64>::new();

        for round in 0..30u64 {
            let mode = round % 5;
            let id = format!("task-{round}");
            let mut bids: Vec<(AccountId, u64, u32)> = Vec::new();
            if mode == 4 {
                // un solo postor: el ganador se conoce antes de fijar la recompensa
                let solo = workers[((round / 5) % workers.len() as u64) as usize].clone();
                bids.push((solo, 1 + rand() % 100, rand() as u32));
            } else if (round / 5) % 3 == 0 {
                // ronda sin pujas: se cierra sin ganador
            } else {
                let count = 1 + (rand() % 3) as usize;
                while bids.len() < count {
                    let candidate = workers[(rand() % workers.len() as u64) as usize].clone();
                    if !bids.iter().any(|(worker, _, _)| *worker == candidate) {
                        bids.push((candidate, 1 + rand() % 500, rand() as u32));
                    }
                }
            }

            let reward: u128 = if mode == 4 {
                let spent = contract
                    .spent_by_agent
                    .get(&bids[0].0)
                    .copied()
                    .unwrap_or(0);
                cap - spent + 1 // supera el tope restante: la tarea se reembolsa
            } else {
                100 + (rand() % 900) as u128
            };

            set_context("publisher.testnet", 1, reward);
            contract.post_task(id.clone(), verifier.clone(), 2, 3);
            escrow += reward;

            for (worker, price, salt) in &bids {
                set_context(worker.as_str(), 2, 0);
                contract.commit_bid(id.clone(), bid_commitment(worker, *price, *salt));
            }
            // un compromiso sin revelar debe ignorarse al cerrar la ronda
            let silent = bids.len() > 1 && round % 7 == 3;
            for (index, (worker, price, salt)) in bids.iter().enumerate() {
                if silent && index + 1 == bids.len() {
                    continue;
                }
                set_context(worker.as_str(), 4, 0);
                contract.reveal_bid(id.clone(), *price, *salt);
            }

            set_context("closer.testnet", 6, 0);
            contract.close_round(id.clone());
            let winner = contract.tasks.get(&id).unwrap().winner.clone();

            match mode {
                0 | 1 => {
                    if let Some(worker) = winner.clone() {
                        set_context(worker.as_str(), 7, 0);
                        contract.submit_result(id.clone(), format!("rh-{round}"));
                        set_context(verifier.as_str(), 8, 0);
                        contract.attest(id.clone(), mode == 0);
                        let twice = catch_unwind(AssertUnwindSafe(|| {
                            contract.attest(id.clone(), true);
                        }));
                        assert!(twice.is_err(), "round {round}: attest applied twice");
                        if mode == 0 {
                            *alpha_delta.entry(worker).or_insert(0) += 1;
                        } else {
                            *beta_delta.entry(worker).or_insert(0) += 1;
                        }
                    } else {
                        set_context("publisher.testnet", 106, 0);
                        contract.refund_expired(id.clone());
                    }
                }
                2 => {
                    if let Some(worker) = winner.clone() {
                        set_context(worker.as_str(), 7, 0);
                        contract.submit_result(id.clone(), format!("rh-{round}"));
                    }
                    set_context("publisher.testnet", 106, 0);
                    contract.refund_expired(id.clone());
                    let twice = catch_unwind(AssertUnwindSafe(|| {
                        contract.refund_expired(id.clone());
                    }));
                    assert!(twice.is_err(), "round {round}: refund applied twice");
                }
                3 => {
                    // sin resultado: reembolso por gracia que penaliza al ganador
                    set_context("publisher.testnet", 106, 0);
                    contract.refund_expired(id.clone());
                    if let Some(worker) = winner {
                        *beta_delta.entry(worker).or_insert(0) += 1;
                    }
                }
                _ => {
                    if let Some(worker) = winner.clone() {
                        set_context(worker.as_str(), 7, 0);
                        contract.submit_result(id.clone(), format!("rh-{round}"));
                    }
                    set_context(verifier.as_str(), 8, 0);
                    contract.attest(id.clone(), true);
                }
            }

            let state = contract.tasks.get(&id).unwrap().state.clone();
            let settled_reward = contract.tasks.get(&id).unwrap().reward.as_yoctonear();
            match state {
                TaskState::Settled => {
                    paid += settled_reward;
                    assert!(
                        contract.tasks.get(&id).unwrap().result_hash.is_some(),
                        "round {round}: settled without a result"
                    );
                }
                TaskState::Refunded => refunded += settled_reward,
                _ => panic!("round {round}: task left in a non terminal state"),
            }
            assert_eq!(settled_reward, reward, "round {round}: escrow changed");
        }

        assert_eq!(escrow, paid + refunded, "escrow is either paid or refunded");
        let mut total_spent: u128 = 0;
        for worker in &workers {
            let spent = contract.spent_by_agent.get(worker).copied().unwrap_or(0);
            assert!(spent <= cap, "{worker} exceeded the spend cap");
            total_spent += spent;
            let reputation = contract.reputations.get(worker).cloned();
            let (alpha, beta) = reputation
                .map(|entry| (entry.alpha, entry.beta))
                .unwrap_or((1, 1));
            assert_eq!(
                alpha,
                1 + alpha_delta.get(worker).copied().unwrap_or(0),
                "{worker} alpha"
            );
            assert_eq!(
                beta,
                1 + beta_delta.get(worker).copied().unwrap_or(0),
                "{worker} beta"
            );
        }
        assert_eq!(total_spent, paid, "spend ledger matches the settled escrow");
        assert_eq!(contract.list_tasks(0, 1_000).len(), 30);
    }
    #[test]
    fn rejects_attestation_from_a_non_verifier_account() {
        let winner: AccountId = "winner.testnet".parse().unwrap();
        let mut contract = Contract::init(1_000);
        let mut task = closed_task(Some(winner.clone()), Some("result-hash".to_string()));
        task.reward = NearToken::from_yoctonear(500);
        contract.tasks.insert("task-1".to_string(), task);

        let before = contract.get_reputation(winner.clone());

        set_context("stranger.testnet", 9, 0);
        let err = catch_unwind(AssertUnwindSafe(|| {
            contract.attest("task-1".to_string(), true);
        }));
        assert!(err.is_err(), "attest from a foreign account must be rejected");

        let after = contract.tasks.get(&"task-1".to_string()).unwrap();
        assert_eq!(after.state, TaskState::Closed, "settlement must not advance");
        assert_eq!(
            contract.get_reputation(winner.clone()),
            before,
            "foreign attest must not move reputation"
        );
    }

    #[test]
    fn post_task_accepts_64b_id_and_rejects_65b() {
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        let id64 = "a".repeat(super::MAX_ID_LEN);
        contract.post_task(id64.clone(), "verifier.testnet".parse().unwrap(), 10, 10);
        assert!(contract.tasks.get(&id64).is_some(), "64-byte id must be stored");

        let id65 = "b".repeat(super::MAX_ID_LEN + 1);
        let rejected = catch_unwind(AssertUnwindSafe(|| {
            contract.post_task(id65, "verifier.testnet".parse().unwrap(), 10, 10)
        }));
        assert!(rejected.is_err(), "65-byte id must be rejected");
    }

    #[test]
    fn submit_result_accepts_128b_hash_and_rejects_129b() {
        let worker: AccountId = "worker.testnet".parse().unwrap();
        set_context("publisher.testnet", 1, 100);
        let mut contract = Contract::init(1_000);
        contract.post_task(
            "task-1".to_string(),
            "verifier.testnet".parse().unwrap(),
            10,
            10,
        );
        set_context(worker.as_str(), 2, 0);
        contract.register_worker();
        set_context("worker.testnet", 3, 0);
        contract.commit_bid("task-1".to_string(), bid_commitment(&worker, 7, 9));
        set_context("worker.testnet", 11, 0);
        contract.reveal_bid("task-1".to_string(), 7, 9);
        set_context("publisher.testnet", 21, 0);
        contract.close_round("task-1".to_string());

        set_context("worker.testnet", 22, 0);
        let too_long = "x".repeat(super::MAX_RESULT_HASH_LEN + 1);
        let rejected = catch_unwind(AssertUnwindSafe(|| {
            contract.submit_result("task-1".to_string(), too_long)
        }));
        assert!(rejected.is_err(), "129-byte result_hash must be rejected");

        let ok_hash = "y".repeat(super::MAX_RESULT_HASH_LEN);
        contract.submit_result("task-1".to_string(), ok_hash.clone());
        assert_eq!(
            contract
                .tasks
                .get(&"task-1".to_string())
                .unwrap()
                .result_hash
                .as_ref(),
            Some(&ok_hash),
            "128-byte result_hash must be stored"
        );
    }
}
