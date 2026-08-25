# ILAL — Verified Flow, Netted Before the AMM

[![verify](https://github.com/rpnny/ILAL/actions/workflows/ci.yml/badge.svg)](https://github.com/rpnny/ILAL/actions/workflows/ci.yml)
[![network](https://img.shields.io/badge/network-Base%20Sepolia-0052ff)](deployments/base-sepolia/v0.3.3.json)
[![license](https://img.shields.io/badge/license-Apache--2.0-16a34a)](LICENSE)

Current npm preview: `npm install -g @ilalv3/cli@next`
(`v0.4.0-v2-poc.6`, including state-aware institutional netting preflight). The
public `latest` channel remains `v0.3.3` because the netting and V2 stacks are
separate unaudited Base Sepolia candidates.

Institutions can submit mutually offsetting orders without sending all of that
gross flow through an external market. ILAL verifies every participant, nets
compatible stablecoin orders atomically, and routes only the unmatched residual
to Uniswap v4.

> **100 token0 → token1 + 70 token1 → token0 = 140 gross matched internally,
> 30 token0 residual sent to the AMM.**

## Hookathon provenance

| Before Hookathon | Built during Hookathon |
|---|---|
| [`v0.4.0-v2-poc.4`](releases/v0.4.0-v2-poc.4.json), commit `0a9a749`: CNF credentials, PolicyRegistry, one-time sessions, bounded Router, v1/v2 ZK experiments, CLI and historical demos. | InstitutionalNettingHook and BatchRouter; deterministic signed-order allocation; atomic 1:1 stablecoin netting; residual-only v4 routing; netting CLI and invariant suite; live Base Sepolia candidate with forward/reverse batches and Sourcify exact-match verification. |

The pre-Hookathon code is eligibility and execution infrastructure. The new
submission mechanism is the netting path above; the active historical v0.3.3
deployment remains unchanged.

| Reviewer path | Start here |
|---|---|
| Core Hook | [`contracts/src/netting/InstitutionalNettingHook.sol`](contracts/src/netting/InstitutionalNettingHook.sol) |
| Live Hook | [`0xb385…4088` — Sourcify exact match](https://sourcify.dev/server/v2/contract/84532/0xb385043E7489E2683473a0158710e3F9932F4088) |
| Canonical `100/70` demo | [`0x4dc0…dfa9`](https://sepolia.basescan.org/tx/0x4dc0493ea84caeef1dc4f4e8ce4ed3598cd23985ba64f58fbde0ee0c67d6dfa9) |
| Reverse `60/90` demo | [`0x4e4e…2fd8`](https://sepolia.basescan.org/tx/0x4e4e2d6a45c76596a032d7fd09244420f00d56a033fb75f1137bba5f02f82fd8) |
| Deployment evidence | [`candidate-manifest.json`](docs/hookathon/candidate-manifest.json) |
| One-command test | `make verify` |
| Before / built during | [Hookathon scope](#hookathon-scope) |
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

The tick bound is checked exactly once in `openBatch`, before the first order.
It is a **batch-start depeg guard**, not an oracle and not a continuous
in-batch price constraint. Residual execution may move the pool outside the
range; every user's continuing safety boundary is their signed
`minAmountOut` and `maxAmmInput`.

## Hookathon scope

### Before Hookathon

Tag [`v0.4.0-v2-poc.4`](releases/v0.4.0-v2-poc.4.json), commit `0a9a749`,
already contained ILAL's CNF credentials, policy registries, one-time sessions,
bounded Router, v1/v2 ZK experiments, CLI, and historical Base Sepolia demos.
Those components are supporting infrastructure, not the new submission
mechanism.

### Built during Hookathon

- Atomic signed institutional order batches.
- Stablecoin internal netting through `beforeSwap` return deltas.
- Residual-only routing to Uniswap v4.
- Permissionless solver execution with outputs sent directly to signers.
- Solver-independent allocation through Hook-enforced ascending order hashes.
- EIP-712/low-s ECDSA/ERC-1271 validation, nonce cancellation and replay protection.
- Per-order total-output and AMM-exposure bounds.
- Real v4 integration, fuzz, maximum-16-order gas, and stateful invariant tests.
- Reproducible impact benchmark against both vanilla two-swap execution orders.
- Four CLI commands and a terminal demo.
- A live Base Sepolia candidate, two opposite-residual batches, complete evidence
  manifest, and Sourcify creation/runtime exact matches for all first-party contracts.

### Final state

ILAL's submission path is now deliberately narrow:

> **verify → match → net → route residual to Uniswap**

The prior v1/v2 credential and policy work remains in the repository for
provenance and as reusable eligibility infrastructure. It is not presented as
multiple competing Hookathon Hooks.

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
| Foundry | 265 passed, 0 failed, 0 skipped |
| Netting stateful invariants | 100,000 handler calls, 0 failures/reverts |
| CLI | 54 passed |
| SDK | 18 passed |
| Circuit oracle | 8 passed |
| Policy circuit v2 | 1 valid witness accepted; 4 adversarial witnesses rejected |

The integration suite proves that the final pool state and manager balance
changes for the `100/70` batch exactly equal a vanilla 30-token0 residual swap
from the same initialized state. The 16-order case currently uses about 1.53M
gas in the Foundry test environment. `make verify` also checks release/
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
| `25 token1` | 40.00% | +0.025001 (2.00 bps) | 40.00% | 662,890 / 195,556 (3.39x) |
| `50 token1` | 66.67% | +0.050000 (3.34 bps) | 66.67% | 662,891 / 195,557 (3.39x) |
| `70 token1` | 82.35% | +0.070000 (4.12 bps) | 82.35% | 663,386 / 195,556 (3.39x) |
| `90 token1` | 94.74% | +0.090001 (4.74 bps) | 94.74% | 662,890 / 195,556 (3.39x) |
| `100 token1` | 100.00% | +0.100001 (5.00 bps) | 100.00% | 622,455 / 195,567 (3.18x) |

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
premium is **449,430 gas**. With ETH/USD fixed at a **$3,000 scenario input**:

| Gas-price scenario | Break-even anchor notional | Break-even gross notional |
|---:|---:|---:|
| 0.01 gwei | $19.26 | $32.74 |
| 0.1 gwei | $192.61 | $327.44 |
| 1 gwei | $1,926.14 | $3,274.44 |

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
blocker. See [`docs/research/`](docs/research/).

## Deployment status

The Hookathon stack has a Base Sepolia-only deployment script at
[`contracts/script/DeployHookathonNetting.s.sol`](contracts/script/DeployHookathonNetting.s.sol).
It binds the official PoolManager, PositionManager and Permit2 addresses,
deploys two 6-decimal mock stablecoins, MockEAS, CNFIssuer, PolicyRegistry,
BatchRouter and a CREATE2-mined `0x88` Hook, onboards two distinct institutions,
and seeds liquidity through the standard v4 PositionManager.

The Hookathon deployment is a separate, source-verified **candidate** and does
not replace the active v0.3.3 Base Sepolia demo. The canonical `100/70` batch
matched 140,000,000 gross raw units and sent only 30,000,000 token0 units to
the AMM. The reverse `60/90` batch sent only 30,000,000 token1 units. All seven
first-party contracts are Sourcify creation/runtime `exact_match`; addresses,
transactions, decoded events, pool states, CREATE2 salt and bytecode hashes are
recorded in the
[`candidate manifest`](docs/hookathon/candidate-manifest.json).

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
identity data. The tick guard is a batch-start depeg circuit breaker, not an
oracle or a continuous price bound.
The Hook is immutable and a serious defect requires a new Hook and pool; see
[`docs/INCIDENT_AND_MIGRATION_RUNBOOK.md`](docs/INCIDENT_AND_MIGRATION_RUNBOOK.md).

See [`SECURITY.md`](SECURITY.md), [`NOTICE`](NOTICE), and
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). First-party code is
Apache-2.0.
