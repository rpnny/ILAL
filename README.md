# ILAL — Institutional Access and Execution for Uniswap v4

[![Verify](https://github.com/rpnny/ILAL/actions/workflows/ci.yml/badge.svg)](https://github.com/rpnny/ILAL/actions/workflows/ci.yml)
[![Network](https://img.shields.io/badge/network-Base%20Sepolia-0052FF)](deployments/base-sepolia/v0.3.3.json)
[![License](https://img.shields.io/badge/license-Apache--2.0-16a34a)](LICENSE)

> Prove eligibility once. Net what cancels. Send only the residual to Uniswap v4.

## What is ILAL?

ILAL (Institutional Liquidity Access Layer) is a compliance and settlement layer for Uniswap v4. It addresses two barriers to institutional onchain execution:

1. **Compliance overhead** — an institution should not repeat the same eligibility checks for every action.
2. **Market exposure** — when eligible orders oppose each other, sending both gross legs through an AMM creates avoidable price impact and information leakage.

ILAL separates **who may act** from **how signed orders settle**:

- **Session** grants short-lived, scoped access after an institution proves policy eligibility.
- **SOEE** verifies and nets signed orders atomically, routing only the residual imbalance through Uniswap v4.

Session and SOEE are independent Base Sepolia candidates today; their combined architecture is the intended system, not a claim that the two candidates are already integrated.

### Live result

In the latest public settlement, two institutions submitted **0.10 USDC** and **0.07 hUSDT** in opposite directions. ILAL matched **0.14 of 0.17 gross flow internally** and sent only **0.03 USDC** to the AMM: **82.35% less AMM exposure**.

[View the successful Base Sepolia transaction](https://sepolia.basescan.org/tx/0x160955bcf29e8e11399be0d3db68d1996e19a9ac76361eadbec6904f00a6fc98)

> This is an equal-decimal, 6-decimal stablecoin proof of concept. hUSDT is an ILAL test representation, not official USDT.

## Judge in 60 seconds

| What to inspect | Evidence |
| --- | --- |
| Uniswap v4 Hook | [`InstitutionalNettingHook.sol`](contracts/src/netting/InstitutionalNettingHook.sol) |
| Atomic batch router | [`InstitutionalBatchRouter.sol`](contracts/src/netting/InstitutionalBatchRouter.sol) |
| Chainlink integration | [`ChainlinkStablecoinOracleGuard.sol`](contracts/src/oracle/ChainlinkStablecoinOracleGuard.sol) and the [Hook call site](contracts/src/netting/InstitutionalNettingHook.sol) |
| Current deployment evidence | [`chainlink-candidate-manifest.json`](docs/hookathon/chainlink-candidate-manifest.json) |
| Core tests | [`InstitutionalNetting.t.sol`](contracts/test/InstitutionalNetting.t.sol) and [`InstitutionalNettingInvariant.t.sol`](contracts/test/InstitutionalNettingInvariant.t.sol) |
| Submission scope and findings | [`UHI10_PRE_SUBMISSION_REVIEW_ZH.md`](audit/UHI10_PRE_SUBMISSION_REVIEW_ZH.md) |
| Demo materials | [`ilal-soee-demo-day-v6.html`](docs/hookathon/ilal-soee-demo-day-v6.html) and [`hookathon-pitch-demo.command`](scripts/hookathon-pitch-demo.command) |

Run the full repository verification:

```bash
make verify
```

## Architecture: Session + SOEE

### Session — access layer

- **What:** determines who may use a protected liquidity path.
- **How:** an institution proves policy eligibility through the configured EAS or ZK path and receives a short-lived, scoped grant.
- **Why:** eligibility can be reused during a bounded session without publishing private identity data on every trade.

The V2 candidate supports Groth16 verification, short-lived policy grants, and one-time scoped session authorization.

### SOEE — settlement and execution layer

- **What:** determines how a group of eligible signed orders executes.
- **How:** the router canonicalizes the order set, the Hook validates policy and orders, opposite flow is netted with before-swap deltas, and only the imbalance reaches the v4 pool.
- **Why:** it reduces public AMM exposure while preserving atomic settlement and user-defined bounds.

The current SOEE candidate uses the V1 policy/CNF path. An order contains its side, amount, minimum output, maximum AMM input, deadline, and nonce, and supports EIP-712 signatures from EOAs and ERC-1271 accounts.

## The 100/70 result

Suppose Institution A buys 100 units while Institution B sells 70:

```text
Without ILAL: 100 + 70 = 170 units touch the AMM
With ILAL:     70 + 70 = 140 units settle internally
               100 - 70 = 30 units touch the AMM
```

| Metric | Result |
| --- | ---: |
| Gross submitted flow | 170 |
| Gross internally matched flow | 140 |
| Residual AMM flow | 30 |
| Reduction in AMM exposure | **82.35%** |
| Aggregate output improvement in the benchmark | **+4.12 bps** |

The final pool state is identical to a vanilla swap of only the 30-unit residual. ILAL does not manufacture liquidity; it removes flow that cancels before using Uniswap's liquidity.

## How SOEE works

```text
Eligible institutions sign bounded orders locally
                    ↓
Router sorts the fixed order set by order hash
                    ↓
One PoolManager.unlock call opens atomic settlement
                    ↓
Hook checks Chainlink/pool conditions, signatures,
policy, CNF, deadlines, limits, and nonces
                    ↓
Opposite flow nets internally via beforeSwap deltas
                    ↓
Only the residual imbalance swaps through Uniswap v4
```

Important execution properties:

- For a fixed signed order set, permutation cannot change the batch ID, allocation, or pool result.
- The solver still chooses batch membership and timing; a signer can influence its order hash through its nonce. Allocation is sequential, not pro-rata or strategy-proof.
- `minAmountOut` and `maxAmmInput` bound each order. A failed check reverts the entire batch.
- The MVP supports 2–16 exact-input orders for equal-decimal ERC-20 stablecoins, raw-unit 1:1 internal netting, zero netting fee, and an opening pool-tick band of ±100.
- Chainlink is a batch-opening circuit breaker, not the execution price. Actual execution remains bounded by the signed order and v4 pool state.

## What was built during the Hookathon

ILAL existed before UHI10. This submission isolates the new SOEE work from prior infrastructure.

**Existing before the Hookathon:** credential and policy primitives, sessions, an earlier router, ZK research, and CLI foundations.

**New Hookathon work:**

- Uniswap v4 institutional netting Hook and atomic batch router.
- EIP-712/ERC-1271 signed orders, canonical ordering, nonce consumption, and bounded allocation.
- Before-swap delta accounting and residual-only AMM execution.
- Preflight and double-simulation paths.
- Chainlink stablecoin circuit breaker.
- Unit, fuzz, fork, adversarial, invariant, CLI, and SDK tests.
- Base Sepolia deployments and transaction-level evidence.

See [`UHI10_PRE_SUBMISSION_REVIEW_ZH.md`](audit/UHI10_PRE_SUBMISSION_REVIEW_ZH.md) for the reviewed submission boundary and known limitations.

## Partner integration: Chainlink

ILAL uses [Chainlink Data Feeds](https://docs.chain.link/data-feeds/price-feeds) as a fail-closed guard before a batch opens. [`ChainlinkStablecoinOracleGuard.sol`](contracts/src/oracle/ChainlinkStablecoinOracleGuard.sol) validates positive answers, round completeness, staleness, each asset's deviation from USD, and pair divergence. The Hook then combines that result with its pool-tick check before settlement.

The Base Sepolia candidate references Chainlink's [USDC/USD](https://data.chain.link/feeds/base/base-sepolia/usdc-usd) and [USDT/USD](https://data.chain.link/feeds/base/base-sepolia/usdt-usd) feeds. Current limits are 100 bps per feed from $1, 100 bps pair divergence, 90,000-second staleness, and a ±100 opening tick.

Tests are in [`ChainlinkStablecoinOracleGuard.t.sol`](contracts/test/ChainlinkStablecoinOracleGuard.t.sol) and [`ChainlinkStablecoinOracleGuardFork.t.sol`](contracts/test/ChainlinkStablecoinOracleGuardFork.t.sol).

Official Circle Base Sepolia USDC is a deployment dependency, not a claimed partner integration. Base Sepolia has no sequencer-uptime check in this candidate; adding the correct L2 liveness control is a production blocker.

## Demo and live evidence

### Latest institution-app settlement

- **Transaction:** [`0x1609…fc98`](https://sepolia.basescan.org/tx/0x160955bcf29e8e11399be0d3db68d1996e19a9ac76361eadbec6904f00a6fc98)
- **Hook:** [`0x8d1f…0088`](https://sepolia.basescan.org/address/0x8d1fA43F848701b2adB105D5c925A9247E600088)
- **Router:** [`0x9645…2506`](https://sepolia.basescan.org/address/0x96456C68f25A1Fa6C2F2751183401ac26A732506)
- **Orders:** A paid 0.10 USDC; B paid 0.07 hUSDT.
- **Settlement:** 0.07 each side matched internally; only 0.03 USDC entered the AMM.
- **Outputs:** A received 0.099796 hUSDT; B received 0.07 USDC.
- **State:** both nonces consumed; Hook and Router ended with zero token inventory.
- **Gas used:** 621,018.

Other public settlements:

- [Reverse-direction batch](https://sepolia.basescan.org/tx/0x588ac879d9287435e04af158acf4b491f77baa2cdfe6e6729eab16ecf46f5172)
- [Four-order batch](https://sepolia.basescan.org/tx/0xf6d74bd973b6c26c63ec7317dff87ba8055d8946eb2b637791b5376e1d335954)
- [Sixteen-order batch](https://sepolia.basescan.org/tx/0x883560276318337104db9020513ec685bb8ae672a3678f77d682f885093f40b7)

For the reviewer flow, open the deck and run the guided demo:

```bash
./scripts/hookathon-pitch-demo.command
```

## Verification and economics

The current verification suite covers:

| Suite | Result |
| --- | ---: |
| Foundry tests | 282 |
| Invariant calls | 100,000 |
| CLI tests | 56 |
| SDK tests | 18 |
| Circuit oracle checks | 8 |
| V2 policy vectors | 1 valid + 4 adversarial |

The canonical 100/70 benchmark measured aggregate output of **169.984100** with ILAL versus **169.914100** for gross vanilla execution: **+0.070000**, or **+4.12 bps**. It also measured **698,353 gas** versus **195,556 gas** (**3.57×**), leaving a break-even premium of **485,401 gas**.

At 1 gwei, illustrative break-even trade-value anchors are $1,386.87 at $2,000/ETH, $2,080.31 at $3,000/ETH, and $2,773.74 at $4,000/ETH. These are sensitivity scenarios, not a live ETH-price claim or a forecast.

Methodology and reproducible artifacts:

- [`BENCHMARK.md`](docs/hookathon/BENCHMARK.md)
- [`BREAK_EVEN.md`](docs/hookathon/BREAK_EVEN.md)
- [`ILAL_INSTITUTIONAL_STRESS_VALUE_REPORT_EN.md`](docs/research/ILAL_INSTITUTIONAL_STRESS_VALUE_REPORT_EN.md)

## Deployment and security

Current Chainlink-guarded Base Sepolia candidate (chain ID 84532):

- [Verified Hook source](https://sourcify.dev/server/v2/contract/84532/0x8d1fA43F848701b2adB105D5c925A9247E600088)
- [Verified oracle guard source](https://sourcify.dev/server/v2/contract/84532/0x1dEc06Bd8d43E37c855767326864BEe0Ae6199D3)
- [`DeployHookathonNetting.s.sol`](contracts/script/DeployHookathonNetting.s.sol)

This software is **unaudited and Base Sepolia only**. The Hook is immutable; a serious defect requires a new Hook and pool. Review [`SECURITY.md`](SECURITY.md), the [`INCIDENT_AND_MIGRATION_RUNBOOK.md`](docs/INCIDENT_AND_MIGRATION_RUNBOOK.md), and [`ILAL_CURRENT_AUDIT_SCOPE.md`](audit/ILAL_CURRENT_AUDIT_SCOPE.md) before evaluating any production use.

## Repository map

| Area | Path |
| --- | --- |
| Netting contracts | [`contracts/src/netting`](contracts/src/netting) |
| Oracle integration | [`contracts/src/oracle`](contracts/src/oracle) |
| CLI | [`cli`](cli) |
| ZK circuits | [`circuits`](circuits) |
| Hookathon evidence | [`docs/hookathon`](docs/hookathon) |
| Security material | [`audit/ILAL_CURRENT_AUDIT_SCOPE.md`](audit/ILAL_CURRENT_AUDIT_SCOPE.md) |
| Deployments | [`deployments`](deployments) |

## License

[Apache License 2.0](LICENSE)
