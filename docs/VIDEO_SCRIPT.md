# Demo video script (60-90 s)

1. Problem (0-15 s). One week of our AI agent swarm: 22,957 runs, 386 verified results (1.7%); 91% of the paid spend went to runs with no verified result.
2. Demo (15-45 s). Terminal: `make demo`. Show the simulator, the near-sandbox round reaching `Settled`, and the summary: cost per verified result 100 (market) vs 4,000 (round-robin) on the same rounds and ledger rates, and the horizon line (the market verifies 2x more at 1,000 rounds, 3.7x at 5,000).
3. Live on testnet (45-65 s). Open `/?contract=market.hidra-mkt-221016.testnet` in the page: the settled round, the 0.08 NEAR bid, the 0.1 NEAR payment, worker-1 at Beta(2,1). Cut to NearBlocks: the `attest` transaction `7P7EjoEh...` that released the escrow.
4. Security (65-85 s). worker-1 has exactly one key on testnet: FunctionCall to the market for four methods, 0.25 NEAR allowance; its commit and reveal were signed with that key. Only the task verifier can release the escrow.
5. Close (85-90 s). Built at NEAR HACKATHON. Repository link.
