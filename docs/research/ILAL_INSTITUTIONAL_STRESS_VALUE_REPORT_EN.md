# ILAL Institutional Stress & Value Validation Report

## 1. Executive verdict

**PASS — ready for institutional pilot.** This result does not claim production readiness before an independent audit.

The study emits 160 economic rows, with 40 measured 5 bps scenarios. The 1/30/100 bps rows are explicit unsupported configurations. Official Base Universal Router + Permit2 independent and bundled paths were executed at finalized block 50394803 with real USDC/USDT bytecode.

The conservative strict-gate net benefit for $10k/70%/5bps/scaled is **$4.748** against universal-router-bundled, after the 1 gwei L2 gas premium, the full candidate L1 security fee, and a 0.5 bps solver reserve.

## 2. Research questions and hypotheses

The program tests economic usefulness for stablecoin desks, operational usefulness for RWA issuers, protocol safety under adversarial state changes, and signer-free solver preflight accuracy.

## 3. Environment and reproducibility

- Schema: institutional-study-v1; seed: 0x494c414c2d494e535449545554494f4e414c2d53545544592d5631
- Local toolchain: forge Version: 1.5.1-stable
- Base fork: chain 8453, finalized block 50394803
- Entry points: make study-local / study-fork / study-rwa / study-report / study-full
- Website values are generated from machine results.

## 4. Safety and atomicity

Stateful handler calls: 100000; fuzz runs per property: 10000. Regressions cover peg boundaries, allowance/balance races, deadlines, revocation, policy rotation, permissionless executors, nonce rollback, conservation and zero inventory.

## 5. Profitability heatmap

See [profitability-heatmap.svg](charts/profitability-heatmap.svg). Only the 5 bps candidate surface is measured.

## 6. Capacity frontier

The fixed candidate depth contains 5 measured capacity failures and preserves the 100k/70k atomic rollback regression. The complete binary-search frontier is COMPLETE: 135 rows spanning $257 to $1000000. See [capacity-frontier.svg](charts/capacity-frontier.svg).

## 7. Multi-order scalability

12 scenarios cover 2/4/8/16 orders and three distributions. Uniform 16-order total gas is 1787349; rounding dust is zero and canonical commitments are permutation-stable.

## 8. Base production-fee benchmark

The model includes L2 execution and L1 security fees. The candidate L1 fee uses GasPriceOracle.getL1Fee on the complete serialized historical transaction. The production baseline uses deployed Universal Router V2.1.1, Permit2, the official PoolManager and real token bytecode.

## 9. RWA issuer workflow

Largest dataset: 100000 wallets; total 483.83 seconds; peak RSS 3.63 GiB; proof p95 3459.5 ms.

## 10. TCO sensitivity

The 243-row model varies staff at $50/$100/$200 per hour, ETH at $2k/$3k/$4k and L2 gas at 0.01/0.1/1 gwei. It reports issuer-paid, user-paid and system totals and is not a customer ROI claim.

## 11. Failures and remediation

The implementation removes O(n²) issuer import lookup, rejects duplicate wallets, adds pinned-block preflight and double simulation, and documents the immutable fee/token surface.

## 12. Supported operating envelope

2–16 orders; equal-decimal standard ERC-20 stablecoins; raw-unit 1:1; 5 bps; tick spacing 10; ±100 batch-start tick guard. Fee-on-transfer, rebasing, callback/nonstandard tokens, other fee tiers and capacity-exceeding batches are unsupported.

## 13. PASS / CONDITIONAL / FAIL

| Study | Gate | Status | Note |
|---|---|---|---|
| local | core-matrix-count | PASS |  |
| local | known-fixed-depth-regression | PASS |  |
| local | anchor-local-economics | PASS | Local-only signal; production gate remains pending L1 fee and official router baselines. |
| local | preflight-execution-consistency | PASS | Each frontier verdict is the same complete execution call used by eth_call preflight at one state snapshot. |
| local | production-economic-gate | NOT_RUN | Delegated to pinned Base fork: PASS |
| fork | fork-code-surface | PASS |  |
| fork | official-universal-router-full-fill | PASS |  |
| fork | production-economic-gate | PASS |  |
| rwa | rwa-100k-total-time | PASS |  |
| rwa | rwa-100k-peak-rss | PASS |  |
| rwa | proof-p95 | PASS |  |
| local | stateful-handler-calls | PASS |  |
| local | fuzz-cases-per-property | PASS |  |
| local | adversarial-regressions | PASS |  |

## 14. Production blockers and next steps

Independent audit remains mandatory. Proof generation peaked at 3.63 GiB, so a pilot host needs more than 4 GiB of actually available memory plus operating headroom. Missing full capacity or 100k issuer/proof evidence keeps the result conditional; any P0/P1 or strict economic failure is a FAIL/NO-GO.
