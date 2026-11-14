# Final demo cut: 60 seconds

`demo.mp4`: 1280x720, H.264 yuv420p, 30 fps, faststart, silent.
Browser-captured still-shot montage of the built web app (`web/dist`, served
locally) with readable fixed holds; no sped-up cut and no simulated explorer
interface.

| Time | On-screen caption | Visible evidence |
|---|---|---|
| 0-6 | 90.55% of estimated spend had no verified result | Frozen product ledger comparison; 90.55% rounded, 22,957 executions, 386 verified outcomes |
| 6-12 | Commit: sealed until the reveal window | Frozen product lifecycle; round 5 winner's actual commit hash and public URL |
| 12-18 | Reveal: valid bids open; lowest score wins | Product lifecycle; round 5 bid prices, winner, actual reveal hash and public URL |
| 18-25 | Attest passes: worker paid on NEAR testnet | Local round 5 receipt: Settled, attest_ok true, 0.05 NEAR escrow, full attestation hash |
| 25-32 | Attest fails: publisher refunded | Local round 1 receipt: Refunded, attest_ok false, 0.05 NEAR escrow, full attestation hash |
| 32-37 | Real attack fixed: oversized result | testnet_security.json: 129-byte hash rejected, 128-byte limit, valid result subsequently Settled |
| 37-42 | Real attack fixed: reputation laundering | testnet_reregistration.json: re-registration rejected, Beta [1, 3, 0.25] unchanged |
| 42-48 | Real attack fixed: zero-price bid | testnet_zero_price.json: price 0 rejected, honest bidder wins, final state Settled |
| 48-54 | 10.6x cheaper per verified result | Frozen product ledger comparison; USD 0.061071 vs 0.005769 per verified result |
| 54-60 | Reproduce locally: make demo | Product lifecycle, make demo, github.com/andres20980/hidra-market |

The 10.6x figure is a retrospective application of the escrow payment rule to
the **same outcomes** of 22,957 real ledger executions, not a controlled trial
of new agents or observed production savings. Estimated total costs are
USD 23.5734 vs USD 2.2268 for the same 386 verified results.
The old 72% and 40x headlines are not used. Any separate 100 vs 4000 / 40x
comparison must be labelled literally `simulated benchmark scenario`.

NearBlocks returned **HTTP 403** for both attestation pages. The cut explicitly
shows local published evidence, full hashes and real public URLs instead:

- Paid: https://testnet.nearblocks.io/txns/2nRfNFS9WhiVotRcuaXZfVCvJccv5odjHGjyGH5eGo5w
- Refunded: https://testnet.nearblocks.io/txns/52qXc3Kk1qyAJx29WfgFwK4JdL5buY9d6HRUzuDykUvH

Every caption maps to a file in this repository: the ledger comparison is
`swarm/out/baseline_compare.json`, the attack rows are the `swarm/out/testnet_*.json`
files, and the round receipts are in `swarm/out/testnet_market.json`.
