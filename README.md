# ILAL — Institutional Access and Execution for Uniswap v4

[![verify](https://github.com/rpnny/ILAL/actions/workflows/ci.yml/badge.svg)](https://github.com/rpnny/ILAL/actions/workflows/ci.yml)
[![network](https://img.shields.io/badge/network-Base%20Sepolia-0052ff)](deployments/base-sepolia/v0.3.3.json)
[![license](https://img.shields.io/badge/license-Apache--2.0-16a34a)](LICENSE)

> **Prove eligibility once. Reuse scoped access. Net verified flow before it
> reaches the AMM.**

ILAL is an institutional access and execution layer for Uniswap v4.

It separates **eligibility verification** from repeated transaction execution,
so institutions do not need to repeatedly expose identity data for every
interaction. At the execution layer, ILAL's SOEE path atomically nets opposing
verified orders and routes only the unmatched residual to Uniswap.

**Less repeated identity disclosure.<br>
Less repeated compliance overhead.<br>
Less unnecessary gross flow hitting public liquidity.**

Current npm preview: `npm install -g @ilalv3/cli@next`
(`v0.4.0-v2-poc.7`, including Chainlink-aware institutional netting preflight).
The public `latest` channel remains `v0.3.3`; the netting and V2 stacks are
separate, unaudited Base Sepolia candidates.

## Two layers, one goal

| | Session | SOEE |
|---|---|---|
| **Problem** | Compliance is repeatedly dragged into execution | Offsetting gross flow unnecessarily reaches the AMM |
| **ILAL approach** | Verify eligibility, then use scoped reusable authorization | Net opposing verified orders before AMM execution |
| **Benefit** | Lower repeated verification overhead and less identity exposure | Lower AMM exposure and better execution when flow offsets |
| **Role** | Institutional access | Institutional execution |

```text
                    ILAL
                     │
         ┌───────────┴───────────┐
         │                       │
      SESSION                   SOEE
  access / eligibility      execution / flow
         │                       │
 scoped reusable access      atomic netting
         │                       │
 less repeated identity      only residual
     disclosure              reaches Uniswap
         │                       │
         └───────────┬───────────┘
                     │
                 Uniswap v4
```

> **Session removes redundant identity verification. SOEE removes redundant
> market execution.**

## The execution problem in one example

Two verified institutions want to trade in opposite directions:

```text
Institution A: 100 token0 → token1
Institution B:  70 token1 → token0
```

### Without SOEE

```text
100 token0 ───────→ Uniswap
 70 token1 ───────→ Uniswap

170 gross flow reaches the AMM
```

### With SOEE

```text
100 ──┐
      ├── 70 ↔ 70 matched internally
 70 ──┘
           │
           ▼
      30 residual
           │
           ▼
      Uniswap v4
```

**Canonical 100/70 result**

| Metric | Result |
|---|---:|
| Gross submitted flow | 170 |
| Internally matched flow | 140 |
| AMM residual | 30 |
| AMM exposure reduction | **82.35%** |
| Aggregate execution improvement | **+4.12 bps** |
| Pool-state proof | **Identical to a vanilla 30-token residual swap** |

> **Why make Uniswap process 170 of gross flow when the actual imbalance is
> only 30?**

ILAL makes public liquidity handle the imbalance instead of mechanically
processing both sides of offsetting institutional flow.

The economic claim is deliberately bounded. Session lowers repeated
compliance-verification overhead. SOEE has higher execution gas, but can reduce
AMM exposure and improve aggregate execution; under the tested conditions, that
benefit outweighs the gas premium. See [Impact benchmark](#impact-benchmark) and
[When is the gas premium worth paying?](#when-is-the-gas-premium-worth-paying)
for the measured tradeoff and break-even assumptions.

## Why ILAL is different

Most execution-protection mechanisms intervene **after order flow reaches
public liquidity**: they improve ordering, fees, auctions, routing, or MEV
handling.

ILAL moves the intervention point upstream.

**Verified opposing flow is netted before it touches the AMM curve.**

This does not claim to eliminate mempool MEV. It reduces the amount of gross
flow that actually interacts with AMM state.

> **Upstream prevention instead of only downstream mitigation.**

## Why compliance does not have to sacrifice privacy

Institutional DeFi often treats compliance and execution as the same problem:
identity information is repeatedly carried into transaction workflows.

ILAL separates them. A participant proves that it satisfies the required
eligibility policy. Execution can then rely on scoped authorization rather than
repeatedly exposing the participant's underlying identity information.

> **Compliance becomes a prerequisite for execution, not a recurring identity
> disclosure during execution.**

This is what the Session layer is designed to provide.

## Why UHI10

### Fair Flow

For a fixed signed order set, allocation is canonicalized by `orderHash` and
independently enforced by the Hook. A permissionless executor cannot reorder the
same batch to decide who receives internal matching and who bears residual AMM
exposure.

### Sustainable Liquidity

Public AMM liquidity handles only the unmatched imbalance. In the canonical
100/70 example, AMM gross-flow exposure falls by **82.35%**.

The tradeoff is explicit: internally matched flow also does not generate the LP
fees it would have generated by passing through the pool.

### MEV surface reduction

ILAL does not claim to hide the entire batch from a public mempool. Internally
matched flow never touches the AMM curve; only the residual changes public pool
state, reducing gross flow exposed to pool-level price impact and extraction.

## Hookathon submission

**ILAL existed before UHI10. The institutional netting execution path did not.**

### Before the Hookathon

[`v0.4.0-v2-poc.4`](releases/v0.4.0-v2-poc.4.json) / commit `0a9a749`:

- Credential and policy infrastructure.
- One-time and scoped sessions.
- Bounded Router.
- v1/v2 ZK research.
- CLI and historical demos.

### Built during the Hookathon

- `InstitutionalNettingHook` and `InstitutionalBatchRouter`.
- Signed institutional orders and canonical deterministic allocation.
- Atomic stablecoin netting through `beforeSwap` return deltas.
- Residual-only Uniswap v4 routing.
- State-aware preflight and double simulation before broadcast.
- Chainlink stablecoin safety gate.
- Invariant, fuzz, capacity, economic and institutional study suites.
- Live Base Sepolia candidate with 2/4/16-order evidence.

> **The Hookathon submission is SOEE: verified flow → net → residual →
> Uniswap.**

The pre-Hookathon components remain supporting access infrastructure. They are
not presented as competing Hookathon Hooks, and the active historical v0.3.3
deployment remains unchanged.

## Reviewer path

| Reviewer path | Start here |
|---|---|
| Core Hook | [`contracts/src/netting/InstitutionalNettingHook.sol`](contracts/src/netting/InstitutionalNettingHook.sol) |
| Chainlink-guarded Hook | [`0x8d1f…0088` — Sourcify exact match](https://sourcify.dev/server/v2/contract/84532/0x8d1fA43F848701b2adB105D5c925A9247E600088) |
| Oracle Guard | [`0x1dEc…199D3` — Sourcify exact match](https://sourcify.dev/server/v2/contract/84532/0x1dEc06Bd8d43E37c855767326864BEe0Ae6199D3) |
| Live forward `0.10/0.07` | [`0x9177…0998`](https://sepolia.basescan.org/tx/0x91770caae1cd596f5974e88997cff364c925b78924cda781026144595c130998) |
| Live reverse `0.06/0.09` | [`0x588a…5172`](https://sepolia.basescan.org/tx/0x588ac879d9287435e04af158acf4b491f77baa2cdfe6e6729eab16ecf46f5172) |
| Live 4 / 16 order | [`4-order`](https://sepolia.basescan.org/tx/0xf6d74bd973b6c26c63ec7317dff87ba8055d8946eb2b637791b5376e1d335954) · [`16-order`](https://sepolia.basescan.org/tx/0x883560276318337104db9020513ec685bb8ae672a3678f77d682f885093f40b7) |
| Current evidence manifest | [`chainlink-candidate-manifest.json`](docs/hookathon/chainlink-candidate-manifest.json) |
| Previous pre-Chainlink Hook | [`0xb385…4088` — historical Sourcify exact match](https://sourcify.dev/server/v2/contract/84532/0xb385043E7489E2683473a0158710e3F9932F4088) |
| Previous `100/70` demo | [`0x4dc0…dfa9`](https://sepolia.basescan.org/tx/0x4dc0493ea84caeef1dc4f4e8ce4ed3598cd23985ba64f58fbde0ee0c67d6dfa9) |
| Previous reverse `60/90` demo | [`0x4e4e…2fd8`](https://sepolia.basescan.org/tx/0x4e4e2d6a45c76596a032d7fd09244420f00d56a033fb75f1137bba5f02f82fd8) |
| Historical deployment evidence | [`candidate-manifest.json`](docs/hookathon/candidate-manifest.json) |
| One-command test | `make verify` |
| Before / built during | [Hookathon submission](#hookathon-submission) |
| Atomic executor | [`contracts/src/netting/InstitutionalBatchRouter.sol`](contracts/src/netting/InstitutionalBatchRouter.sol) |
| Integration tests | [`contracts/test/InstitutionalNetting.t.sol`](contracts/test/InstitutionalNetting.t.sol) |
| Stateful invariants | [`contracts/test/InstitutionalNettingInvariant.t.sol`](contracts/test/InstitutionalNettingInvariant.t.sol) |
| Demo | [`scripts/demo-netting.sh`](scripts/demo-netting.sh) |
| Mechanism and runbook | [`docs/HOOKATHON_NETTING.md`](docs/HOOKATHON_NETTING.md) |

## The mechanism

```text
signed + currently eligible orders
                │
                ▼
      InstitutionalBatchRouter
       ├─ sort orderHash ascending
       └─ keep signatures paired
                │ one PoolManager.unlock
                ▼
      InstitutionalNettingHook
       ├─ require fresh Chainlink USD feeds
       ├─ require pool opening tick within ±100
       ├─ verify EIP-712 / ERC-1271
       ├─ verify current v1 Policy + CNF
       ├─ consume nonce
       └─ match raw units 1:1
                │
                ▼
      only residual → Uniswap v4 AMM
```

The Hook uses v4 `beforeSwap` return deltas (`0x88` flags). Opposing Hook
deltas cancel inside one unlock; the Hook and Router finish with no Token
inventory. Any bad signature, expired or reused nonce, invalid credential,
policy change, non-canonical or duplicate order hash, opening peg violation,
insufficient balance, partial AMM fill, or output slippage failure reverts the
whole batch.

The permissionless solver cannot choose match priority. The Router
canonicalizes order/signature pairs by strict ascending `orderHash`; the Hook
independently verifies that order before allocating matched input. Reordering
the same signed set therefore produces the same `batchId`, per-user allocation,
and pool result. Duplicate hashes are rejected rather than tie-broken.

This MVP supports one equal-decimal ERC-20 stablecoin pool, exact-input orders,
raw-unit 1:1 matching, zero netting fee, 2–16 orders, and a ±100 tick opening
guard. `minAmountOut` protects total matched-plus-AMM output;
`maxAmmInput` caps each order's residual exposure.

The immutable Chainlink guard and pool tick are checked exactly once in
`openBatch`, before nonce consumption or asset movement. Each USD feed must be
within 100 bps of $1, no older than 90,000 seconds, and within 100 bps of the
other feed. Chainlink is a **batch-opening circuit breaker**, not the execution
price. Residual execution may move the pool outside the opening range; every
user's continuing safety boundary is their signed `minAmountOut` and
`maxAmmInput`.

## Partner integrations

### Chainlink

ILAL uses [Chainlink Data Feeds](https://docs.chain.link/data-feeds/price-feeds)
as an onchain hard safety boundary for stablecoin batches. The standalone
[`ChainlinkStablecoinOracleGuard`](contracts/src/oracle/ChainlinkStablecoinOracleGuard.sol)
normalizes two USD feeds to 18 decimals and fails closed on bad contracts,
failed calls, invalid rounds or answers, future/stale timestamps, single-asset
depegs, and pair divergence. The
[`openBatch` call site](contracts/src/netting/InstitutionalNettingHook.sol) runs
this external boundary before the independent Uniswap pool-tick boundary.

The Base Sepolia candidate configuration uses the official Chainlink
[USDC/USD](https://data.chain.link/feeds/base/base-sepolia/usdc-usd) and
[USDT/USD](https://data.chain.link/feeds/base/base-sepolia/usdt-usd) feeds.
Unit, integration, adversarial, real-feed fork and CLI decoding coverage live in
[`ChainlinkStablecoinOracleGuard.t.sol`](contracts/test/ChainlinkStablecoinOracleGuard.t.sol),
[`ChainlinkStablecoinOracleGuardFork.t.sol`](contracts/test/ChainlinkStablecoinOracleGuardFork.t.sol),
and [`InstitutionalNetting.t.sol`](contracts/test/InstitutionalNetting.t.sol).
This maps to the Request for Hooks stable-focused, permissioned institutional
execution track.

Base Sepolia does not enable a sequencer uptime check because Chainlink does not
currently list an official Base Sepolia uptime proxy. A Base mainnet deployment
must use the official uptime feed with a 3600-second recovery grace period; its
absence is a production blocker. Circle's official Base Sepolia USDC is an
asset dependency, not a claimed Circle partner integration. The paired hUSDT
is explicitly an ILAL test representation, not official USDT.

## Demo

Each institution signs its own private-key-free order JSON:

```bash
ilal --keystore institution-a.json --password-file institution-a.password \
  netting order sign --zero-for-one --amount-in 100000000 \
  --min-amount-out 99000000 --max-amm-input 30000000 --output order-a.json

ilal --keystore institution-b.json --password-file institution-b.password \
  netting order sign --one-for-zero --amount-in 70000000 \
  --min-amount-out 70000000 --max-amm-input 0 --output order-b.json
```

The solver previews and broadcasts without receiving user output:

```bash
./scripts/demo-netting.sh order-a.json order-b.json \
  --keystore solver.json --password-file solver.password
```

The output prints submitted gross, internally matched gross, residuals, AMM
exposure reduction, `batchId`, settlement events, and the transaction hash.

Applications that only need session construction can install the SDK preview
with `npm install @ilalv3/sdk@next viem`. It adds v1/v2 typed-data signing and
hookData encoding; netting order helpers remain CLI-only in this release.

## Verification

Prerequisites: Foundry, Node.js, npm, Circom, and git.

```bash
make verify
```

| Suite | Current result |
|---|---:|
| Foundry | 282 passed, 0 failed, 0 skipped |
| Netting stateful invariants | 100,000 handler calls, 0 failures/reverts |
| CLI | 56 passed |
| SDK | 18 passed |
| Circuit oracle | 8 passed |
| Policy circuit v2 | 1 valid witness accepted; 4 adversarial witnesses rejected |

The integration suite proves that the final pool state and manager balance
changes for the `100/70` batch exactly equal a vanilla 30-token0 residual swap
from the same initialized state. The 16-order uniform study case uses about
1.83M gas in the Foundry environment; the live Base Sepolia 16-order evidence
used 1,896,404 gas. The isolated two-feed guard call adds
36,360 gas over a constant-snapshot implementation of the same interface;
transaction-level economics below use the full measured batch cost. `make verify` also checks release/
deployment consistency, package contents, Git history, secrets, and dependency
SBOMs.

## Impact benchmark

```bash
make benchmark
```

The reproducible benchmark runs one ILAL batch and both orderings of two
ordinary exact-input v4 swaps from identical pools. It compares ILAL against
the higher-output vanilla ordering and uses the lower vanilla gas result, so
the headline does not depend on a favorable ordering.

| `100 token0` vs | AMM exposure reduction | User output advantage | LP fee reduction | Local execution gas: ILAL / vanilla |
|---:|---:|---:|---:|---:|
| `25 token1` | 40.00% | +0.025001 (2.00 bps) | 40.00% | 698,849 / 195,556 (3.57x) |
| `50 token1` | 66.67% | +0.050000 (3.34 bps) | 66.67% | 698,850 / 195,557 (3.57x) |
| `70 token1` | 82.35% | +0.070000 (4.12 bps) | 82.35% | 698,353 / 195,556 (3.57x) |
| `90 token1` | 94.74% | +0.090001 (4.74 bps) | 94.74% | 698,849 / 195,556 (3.57x) |
| `100 token1` | 100.00% | +0.100001 (5.00 bps) | 100.00% | 657,422 / 195,567 (3.36x) |

For the public `100/70` configuration, aggregate ILAL output is 169.984100
tokens versus 169.914100 for the better vanilla ordering. That is a 0.070000
token, or 4.12 bps, improvement. The same run makes the tradeoff explicit:
signature, eligibility, nonce, canonical-allocation and direct-settlement work
costs more execution gas. LP fee reduction benefits these users but reduces
fees on flow that would otherwise have reached the pool.

See the complete methodology, limitations and generated JSON in the
[`impact benchmark`](docs/hookathon/BENCHMARK.md).

### When is the gas premium worth paying?

```bash
make break-even-benchmark
```

The notional sweep fixes opposing flow at `N / 0.7N` and scales liquidity with
notional to isolate gas amortization. User output improves by approximately
**7.00 bps of anchor notional** while the conservative measured total-gas
premium is **485,401 gas**, including the Chainlink gate. With ETH/USD fixed at
a **$3,000 scenario input**:

| Gas-price scenario | Break-even anchor notional | Break-even gross notional |
|---:|---:|---:|
| 0.01 gwei | $20.80 | $35.37 |
| 0.1 gwei | $208.03 | $353.65 |
| 1 gwei | $2,080.31 | $3,536.52 |

These are sensitivity scenarios, not live ETH or Base gas quotes. The fixed
candidate-liquidity stress test also reports the `100k/70k` case as
**capacity-limited**: neither ILAL nor vanilla fully executes at that depth, so
the row is excluded from break-even interpolation. See the full assumptions,
100/1k/10k/100k sweep and machine-readable output in the
[`gas-cost break-even benchmark`](docs/hookathon/BREAK_EVEN.md).

## Institutional stress and value study

The fail-closed research runner emits `institutional-study-v1` JSON/CSV, pins
the Base fork block and official contract bytecode, measures Base L1 security
fees, exercises the deployed Universal Router + Permit2 surface, runs the
issuer workflow at scale, and generates bilingual reports plus the website
summary.

```bash
make study-local   # 160-row economic grid + 12 multi-order scenarios
make study-fork    # finalized Base fork, real token bytecode, production router
make study-rwa     # 100/1k/10k/100k PII-free issuer datasets + 20 proofs
make study-stress  # >=100k invariant handler calls + 10k fuzz/property
make study-report  # JSON/CSV-derived reports, chart and website summary
make study-full    # complete run plus normalized reproducibility check
```

The strict verdict is `PASS / CONDITIONAL / FAIL`; a passing result means only
**ready for institutional pilot**. Independent audit remains a production
blocker. Start with the consolidated Chinese
[`complete test data and evidence report`](docs/research/ILAL_COMPLETE_TEST_DATA_REPORT_ZH.md),
or read the full [research directory](docs/research/).

## Deployment status

The Hookathon stack has a Base Sepolia-only deployment script at
[`contracts/script/DeployHookathonNetting.s.sol`](contracts/script/DeployHookathonNetting.s.sol).
It binds the official PoolManager, PositionManager and Permit2 addresses,
uses Circle's official 6-decimal test USDC, deploys a 6-decimal hUSDT test
representation, then deploys the Chainlink guard, MockEAS, CNFIssuer,
PolicyRegistry, BatchRouter and a CREATE2-mined `0x88` Hook. It sorts token/feed
pairs by address, validates both real feeds before continuing, onboards two
distinct institutions, and seeds a wide `[-10000,10000]` position plus a
`[-100,100]` stabilizer through the standard v4 PositionManager. The funder must
provide at least 0.65 test USDC or deployment stops before allocation.

The current Chainlink-guarded Hook is
[`0x8d1f…0088`](https://sourcify.dev/server/v2/contract/84532/0x8d1fA43F848701b2adB105D5c925A9247E600088).
Forward, reverse, 4-order and 16-order transactions succeeded on Base Sepolia;
the Hook and Router ended with zero token inventory. All seven first-party
contracts are Sourcify creation/runtime `exact_match`. Addresses, feed rounds,
pinned preflights, transactions and postconditions are recorded in the
[`current candidate manifest`](docs/hookathon/chainlink-candidate-manifest.json).

The pre-Chainlink Hook and its `100/70` and reverse `60/90` transactions remain
separate historical evidence in
[`candidate-manifest.json`](docs/hookathon/candidate-manifest.json). They do not
prove the current bytecode and do not replace the active v0.3.3 testnet demo.

## Supporting infrastructure

| Path | Purpose |
|---|---|
| [`contracts/src/CNFIssuer.sol`](contracts/src/CNFIssuer.sol) | Soulbound v1 compliance credential used by the netting Hook |
| [`contracts/src/PolicyRegistry.sol`](contracts/src/PolicyRegistry.sol) | Current pool eligibility policy with delayed updates |
| [`contracts/src/`](contracts/src) | Historical v1 execution and isolated v2 policy-grant infrastructure |
| [`cli/src/`](cli/src) | Signing, netting, policy, credential and deployment commands |
| [`circuits/`](circuits) | Legacy v1 and isolated v2 ZK research artifacts |
| [`deployments/`](deployments) | Versioned public deployment evidence; v0.3.3 remains active |
| [`audit/`](audit) | Current scope and dated historical review material |

## Security and scope

This is unaudited testnet software. Do not use it with production funds or
identity data. Chainlink and the pool tick are batch-opening circuit breakers,
not execution-price or continuous in-batch bounds.
The Hook is immutable and a serious defect requires a new Hook and pool; see
[`docs/INCIDENT_AND_MIGRATION_RUNBOOK.md`](docs/INCIDENT_AND_MIGRATION_RUNBOOK.md).

See [`SECURITY.md`](SECURITY.md), [`NOTICE`](NOTICE), and
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). First-party code is
Apache-2.0.
