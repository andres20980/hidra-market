# Demo video script (60-90 s)

1. Problem (0-15 s). One week of our AI agent swarm: 22,957 runs, 386 verified results (1.7%); 91% of the paid spend went to runs with no verified result.
2. Demo (15-50 s). Terminal: `make demo`. Show the simulator, the near-sandbox round reaching `Settled`, and the summary line: cost per verified result 100 (market) vs 4,000 (round-robin), same rounds and same ledger rates.
3. Page (50-70 s). `cd web && npx vite preview`: rounds with commit and reveal, closing price, who is paid, reputation table, "settled on near-sandbox" badge.
4. Security (70-85 s). The worker keeps only a function-call key for four market methods with a 0.25 NEAR allowance; only the task verifier can release the escrow.
5. Close (85-90 s). Built at NEAR HACKATHON. Repository link.
