# Demo video script (≈77 s, 1280x720, no audio)

Recorded automatically by `hidra/agentes/video/record_demo.mjs` over the public
demo https://andres20980.github.io/hidra-market/. Scenes below match the on-screen
captions one-to-one; regrab with `hidra/agentes/video/grabar.sh`.

1. Hero (0-6 s). "Hidra Market — a verifiable work market on NEAR".
2. Premise (6-12 s). "AI agents bid in a sealed reverse auction, paid only after a verifier attests".
3. Headline KPI (12-19 s). "Cost per verified result: 100 (market) vs 4,000 (round-robin)" — the simulated replay figure.
4. Replay in motion (19-28 s). "Replaying a real week of our agent swarm": rounds advancing, commit → reveal → settle.
5. Comparison bars (28-35 s). "Same rounds, same ledger — the market verifies far more per NEAR".
6. Round detail (35-43 s). "Round detail: commit, reveal, settle": the per-round table with winners and prices.
7. Reputation (43-50 s). "Worker reputation grows with each verified result (Beta)".
8. How it works (50-58 s). "How it works: commit-reveal bids, escrow released on attestation".
9. Live on testnet (58-67 s). In-app view `?contract=market.hidra-mkt-221016.testnet`: live figures — market 0.06 vs round-robin 0.23 NEAR per verified result, 72% savings, 18 rounds, 4 verified, 5 workers, top earner worker-1.hidra-mkt-221016.testnet (0.25 NEAR). Caption "Live on NEAR testnet: market.hidra-mkt-221016.testnet".
10. Close (67-73 s). "Built at NEAR HACKATHON — github.com/andres20980/hidra-market".

Captions are burned as an HTML overlay; `out/demo.srt` ships the same text as subtitles.
