# ILAL — Institutional Liquidity Access Layer

[![verify](https://github.com/rpnny/ILAL/actions/workflows/ci.yml/badge.svg)](https://github.com/rpnny/ILAL/actions/workflows/ci.yml)
[![release](https://img.shields.io/badge/release-v0.3.3-2563eb)](releases/v0.3.3.json)
[![v2 preview](https://img.shields.io/badge/v2%20preview-v0.4.0--v2--poc.3-111827)](releases/v0.4.0-v2-poc.3.json)
[![network](https://img.shields.io/badge/network-Base%20Sepolia-0052ff)](deployments/base-sepolia/v0.3.3.json)
[![license](https://img.shields.io/badge/license-Apache--2.0-16a34a)](LICENSE)

ILAL is an experimental Uniswap v4 access layer for verified institutional
flow. It combines compliance credentials, one-time session authorization,
pool policy, and bounded execution without moving price discovery away from
Uniswap.

> Compliance is the hook. Prove eligibility, sign locally, and execute through
> Uniswap v4.

## What works today

- `ComplianceHook` gates swaps and liquidity actions using live pool policy and
  credential state.
- One-time EIP-712 sessions bind the user, router, chain, hook, pool, action,
  deadline, and nonce.
- EOA signatures enforce canonical low-s ECDSA; contract wallets use ERC-1271.
- `ILALRouter` enforces swap slippage and LP spend/receive limits on-chain.
- Liquidity positions are caller-scoped, and signed LP exits remain available
  after later policy changes or credential invalidation.
- `CNFIssuer` supports non-transferable credentials issued from EAS
  attestations or Groth16 proofs, with timelocked ZK configuration.
- The CLI supports encrypted Web3 v3 keystores, capability-checked RPC-managed
  accounts, and offline Safe administrative proposals.

The isolated v2 policy-grant path is implemented, constraint-tested, and
deployed as a public Base Sepolia PoC candidate. It remains separate from the
active v1 CLI preset because its proving key uses an unsafe development
ceremony and its testnet admin is an EOA. See the
[`v2 deployment manifest`](deployments/base-sepolia/v0.4.0-v2-poc.1.json) and
[`V2 testnet runbook`](docs/V2_TESTNET_RUNBOOK.md). Issuers can operate an
encrypted deterministic credential tree and export wallet-bound private
witnesses with the [`Issuer Integration Kit`](docs/ISSUER_INTEGRATION.md).
The kit is distributed as an explicitly non-production npm preview:
`npm install -g @ilalv3/cli@next`.

## How it works

```text
EAS attestation or ZK proof
              │
              ▼
         CNFIssuer
              │
              ▼
       one-time session
              │
              ▼
         ILALRouter ───── bounded swap / LP settlement
              │
              ▼
      ComplianceHook ─── policy, credential, signature, nonce
              │
              ▼
      Uniswap v4 PoolManager
```

The active v1 execution path is documented in
[`docs/CODEBASE_GUIDE.md`](docs/CODEBASE_GUIDE.md).

## Live demo and evidence

| Surface | Current status |
|---|---|
| Source and CLI | npm `latest`: `v0.3.3`; V2 issuer preview: `v0.4.0-v2-poc.3` on `next` |
| Active deployment | Base Sepolia v0.3.3 demo |
| V2 candidate | Base Sepolia `v0.4.0-v2-poc.1`; public proof/grant/LP/swap evidence |
| Administration | Safe-controlled |
| Attestation | MockEAS demo issuance |
| ZK | V1 active stack: disabled; V2 public candidate: Groth16 development ceremony |
| Audit | Unaudited |
| Production readiness | Not production-ready |

The versioned
[`v0.3.3 deployment manifest`](deployments/base-sepolia/v0.3.3.json)
contains addresses, transactions, constructor data, role checks, bytecode
hashes, and source-verification evidence. The
[`demo runbook`](DEMO.md) covers the positive and negative flows.

The v0.3.2 deployment is retained only as deprecated historical evidence and
is never selected by the current CLI.

## Verification

Prerequisites: Foundry, Node.js, npm, Circom, and git.

```bash
make verify
```

Current verified suites:

| Suite | Result |
|---|---:|
| Foundry | 188 passed, 0 failed, 0 skipped |
| CLI | 43 passed |
| SDK | 18 passed |
| Circuit oracle | 7 passed |
| Policy circuit v2 | 1 valid witness accepted; 4 adversarial witnesses rejected |
| Fuzzing | 256 runs per fuzz test |

`make verify` also validates deployment/release metadata, package contents,
Git history, secret scanning, and dependency SBOM generation.

## Code map

| Path | Purpose |
|---|---|
| [`contracts/src/`](contracts/src) | Router, hooks, issuer, policy registries, and verifier adapters |
| [`contracts/test/`](contracts/test) | Foundry unit, integration, regression, and fuzz tests |
| [`cli/src/`](cli/src) | CLI commands, signing, Safe proposals, and deployment tooling |
| [`sdk/src/`](sdk/src) | Session signing, hook-data encoding, and credential reads |
| [`circuits/`](circuits) | v1 and isolated v2 Circom sources and constraint tests |
| [`deployments/`](deployments) | Versioned deployment manifests and schema |
| [`releases/`](releases) | Software release manifests |
| [`docs/data-room/`](docs/data-room) | Threat model, privileged roles, and public diligence material |
| [`docs/ISSUER_INTEGRATION.md`](docs/ISSUER_INTEGRATION.md) | PII-free JSON/CSV issuer decisions, encrypted trees, witness export, and Safe publication |
| [`audit/`](audit) | Current audit scope plus explicitly dated historical review material |
| [`site/`](site) | Static project website |

The isolated V2 path can be exercised without a public-chain key:

```bash
./scripts/simulate-v2-fork.sh
```

It performs a real Groth16 proof, cached policy grant, liquidity add, swap,
policy revision, and revocation against a fresh Base Sepolia fork. Fork
transaction hashes are local evidence only; the separate V2 candidate manifest
contains the public Base Sepolia evidence.

Start with [`contracts/src/ComplianceHook.sol`](contracts/src/ComplianceHook.sol),
[`contracts/src/ILALRouter.sol`](contracts/src/ILALRouter.sol), and
[`docs/CODEBASE_GUIDE.md`](docs/CODEBASE_GUIDE.md).

## Hookathon partner integrations

No partner integrations.

ILAL's completed supporting integrations are Uniswap v4 core/periphery, EAS
attestation reads, ERC-1271 wallet validation, and optional Safe transaction
proposal submission. Their implementations are located in `contracts/src/`,
`cli/src/safe.ts`, and `cli/src/signer.ts`; they are not presented as
Hookathon partner integrations.

## Security and scope

This repository contains unaudited testnet software. Do not use it with
production funds or identity data. See [`SECURITY.md`](SECURITY.md),
[`RELEASE.md`](RELEASE.md), and the
[`public threat model`](docs/data-room/THREAT_MODEL.md).

Exact-input ERC-20 execution is the current Router scope. Native ETH pools and
exact-output swaps are not supported.

## License

First-party code is Apache-2.0. Generated verifier files and third-party
dependencies retain their respective licenses. See
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) and [`NOTICE`](NOTICE).
