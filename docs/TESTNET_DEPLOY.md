# Testnet deployment

Testnet only. Credentials stay in `swarm/.env`, which git ignores.

1. Create a testnet account (for example with [near-cli-rs](https://github.com/near/near-cli-rs) and the faucet) and a sub-account for the market, e.g. `market.<you>.testnet`.
2. Build and deploy the contract from `contract/`:
   ```bash
   cargo near build non-reproducible-wasm
   near contract deploy market.<you>.testnet use-file target/near/contract.wasm \
     with-init-call init json-args '{"cap_per_agent": 100000000000000000000000000}' \
     prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
   ```
3. Configure the swarm client:
   ```bash
   cp swarm/.env.example swarm/.env   # set NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, NEAR_CONTRACT_ID
   ```
4. Run `make testnet`. You see `OK worker-1.<you>.testnet: 1 key(s) on-chain`: the worker keeps only a function-call key for `register_worker`, `commit_bid`, `reveal_bid` and `submit_result` on the market, with a 0.25 NEAR allowance. The key is written to `swarm/out/worker-1.testnet.key` (mode 600, git-ignored) and never printed.
5. Open the web page with `?contract=market.<you>.testnet` to read the contract views over public RPC.
