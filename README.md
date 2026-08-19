# ILAL — Verified Flow, Netted Before the AMM

[![verify](https://github.com/rpnny/ILAL/actions/workflows/ci.yml/badge.svg)](https://github.com/rpnny/ILAL/actions/workflows/ci.yml)
[![network](https://img.shields.io/badge/network-Base%20Sepolia-0052ff)](deployments/base-sepolia/v0.3.3.json)
[![license](https://img.shields.io/badge/license-Apache--2.0-16a34a)](LICENSE)

Institutions can submit mutually offsetting orders without sending all of that
gross flow through an external market. ILAL verifies every participant, nets
compatible stablecoin orders atomically, and routes only the unmatched residual
to Uniswap v4.

> **100 token0 → token1 + 70 token1 → token0 = 140 gross matched internally,
> 30 token0 residual sent to the AMM.**

| Reviewer path | Start here |
|---|---|
| Core Hook | [`contracts/src/netting/InstitutionalNettingHook.sol`](contracts/src/netting/InstitutionalNettingHook.sol) |
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
policy change, peg violation, insufficient balance, partial AMM fill, or output
slippage failure reverts the whole batch.

This MVP supports one equal-decimal ERC-20 stablecoin pool, exact-input orders,
raw-unit 1:1 matching, zero netting fee, 2–16 orders, and a ±100 tick opening
guard. `minAmountOut` protects total matched-plus-AMM output;
`maxAmmInput` caps each order's residual exposure.

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
- EIP-712/low-s ECDSA/ERC-1271 validation, nonce cancellation and replay protection.
- Per-order total-output and AMM-exposure bounds.
- Real v4 integration, fuzz, maximum-16-order gas, and stateful invariant tests.
- Four CLI commands, a terminal demo, and a dedicated Base Sepolia deployment path.

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

## Verification

Prerequisites: Foundry, Node.js, npm, Circom, and git.

```bash
make verify
```

| Suite | Current result |
|---|---:|
| Foundry | 225 passed, 0 failed, 0 skipped |
| Netting stateful invariants | 5 properties × 256 calls, 0 reverts |
| CLI | 52 passed |
| SDK | 18 passed |
| Circuit oracle | 8 passed |
| Policy circuit v2 | 1 valid witness accepted; 4 adversarial witnesses rejected |

The 16-order integration case currently uses about 1.42M gas in the Foundry
test environment. `make verify` also checks release/deployment consistency,
package contents, Git history, secrets, and dependency SBOMs.

## Deployment status

The Hookathon stack has a Base Sepolia-only deployment script at
[`contracts/script/DeployHookathonNetting.s.sol`](contracts/script/DeployHookathonNetting.s.sol).
It binds the official PoolManager, PositionManager and Permit2 addresses,
deploys two 6-decimal mock stablecoins, MockEAS, CNFIssuer, PolicyRegistry,
BatchRouter and a CREATE2-mined `0x88` Hook, onboards two distinct institutions,
and seeds liquidity through the standard v4 PositionManager.

The Hookathon deployment is currently **candidate / pending broadcast**. It
does not replace the active v0.3.3 Base Sepolia demo. No transaction hash is
claimed until the separate deployer, institution and LP testnet signers are
provided and the evidence checklist is completed.

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
identity data. The tick guard is a narrow depeg circuit breaker, not an oracle.
The Hook is immutable and a serious defect requires a new Hook and pool; see
[`docs/INCIDENT_AND_MIGRATION_RUNBOOK.md`](docs/INCIDENT_AND_MIGRATION_RUNBOOK.md).

See [`SECURITY.md`](SECURITY.md), [`NOTICE`](NOTICE), and
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). First-party code is
Apache-2.0.
