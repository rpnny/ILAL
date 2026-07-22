# ILAL — Institutional Liquidity Access Layer

ILAL is an experimental Uniswap v4 access layer that combines compliance credentials, one-time session authorizations, pool policy, and bounded execution. This repository is the public monorepo for contracts, CLI, SDK, circuits, proving metadata, website, audit scope, and deployment evidence.

## Release status

| Surface | Current status |
|---|---|
| Local source | `v0.3.3-rc.3` release candidate |
| npm stable | `@ilalv3/cli@0.3.2`, deprecated; do not use its old Base Sepolia preset |
| npm legacy | `@ilalv3/cli@0.2.21`, old Router ABI only |
| Active deployment | None |
| Attestation | MockEAS is planned for the next Base Sepolia demo |
| ZK | Experimental; disabled in the public deployment |
| Production readiness | Not production-ready |
| Audit | Unaudited |

The old Base Sepolia v0.3.2 addresses remain in `deployments/base-sepolia/v0.3.2.json` as historical evidence only. Their owner signer was exposed, so the CLI, website, and release material do not select or advertise them as active.

## What is implemented

- `ComplianceHook` and `ComplianceHookV2` enforce credential or policy-grant access, action/caller/chain/pool binding, deadlines, and one-time nonces.
- `ILALRouter` provides bounded swap and liquidity execution and protocol-fee accounting.
- `CNFIssuer` provides soulbound credentials through EAS or Groth16 issuance with timelocked ZK configuration.
- The CLI supports encrypted Web3 v3 keystores, capability-checked RPC-managed accounts, and offline Safe administrative transaction proposals.
- ERC-1271 contract-wallet session signatures are accepted through on-chain `isValidSignature`; EOA sessions retain canonical 65-byte ECDSA checks.

Safe proposal creation, owner confirmation, and execution are separate phases. The CLI does not treat a Safe as an EOA and does not claim native Fireblocks, Copper, HSM, or custody integration.

## Repository map

```text
contracts/           Solidity contracts, scripts, and Foundry tests
cli/                 @ilalv3/cli source and tests
sdk/                 TypeScript SDK
circuits/            Groth16 circuit sources and constraint tests
proving-artifacts/   Checksums and reproducibility metadata; no witness data
deployments/         Versioned deployment manifests and JSON schema
releases/            Software release manifests
audit/               Current audit scope and historical review material
docs/data-room/      Public technical due-diligence materials
site/                Static website source
```

## Verify locally

Prerequisites are Foundry, Node.js, npm, Circom, and git. Contract dependencies are pinned and installed outside Git history by the verification target.

```bash
make verify
```

The baseline is 188 Foundry tests, at least 19 CLI tests, no skipped Foundry tests, and 256 fuzz runs. New tests may increase those totals; reducing the baseline, hiding failures, or adding unexplained skips is not accepted.

## CLI signing model

Encrypted EOA keystore:

```bash
ilal --keystore ./deployer.json --password-file ./deployer.password \
  deploy --chain 84532 --admin 0xSafe --treasury 0xTreasury
```

The password file must be mode `600`. Without `--password-file`, the password is read interactively without echo.
For deployment, the CLI passes the keystore path to Foundry; it does not export the decrypted key into the Forge child environment.

RPC-managed account:

```bash
ilal --rpc-account 0xManagedAccount pool policy set ...
```

Before sending, the CLI verifies the RPC chain and confirms the address is returned by `eth_accounts`. This is not a generic custody adapter.

Offline Safe administrative proposal:

```bash
ilal --safe 0xSafe --safe-output ./policy-proposal.json \
  safe propose --to 0xRegistry --data 0xEncodedCalldata --chain 84532
```

The default is offline JSON only. Submission requires `--submit-safe-proposal`, `--safe-tx-service`, and a Safe owner keystore. Execution and additional owner confirmations remain outside this command.

Legacy `PRIVATE_KEY` compatibility is deliberately restricted to known test networks and requires the explicit `--unsafe-private-key` flag. It is never written to config or logs. Do not use it for deployment or production operations.

## Deployment and release gates

The deployment manifest keeps `admin` and `treasury` independent and records whether a demo intentionally reuses one Safe. It includes source/release commits, toolchain settings, bytecode/ABI hashes, constructor data, transactions, pool data, and role-verification results.

A stable release follows this order:

1. Freeze a clean `sourceCommit`.
2. Build and deploy only that commit with a fresh encrypted deployer.
3. Transfer and verify every privileged role; the deployer retains no undeclared privilege.
4. Commit deployment evidence as `releaseCommit`.
5. Prove that the release-only diff did not alter contracts, compiler config, or build dependencies.
6. Sign `v0.3.3` at the reviewed tag commit.
7. Resolve the tracked `releaseCommit: null` self-reference to that tag SHA in release assets, then build GitHub Release, npm, and website from the same tag.

Stable Base Sepolia deployment is blocked until a new Safe address is supplied. Previously disclosed secrets are permanently treated as compromised and are not reused.

See [RELEASE.md](RELEASE.md), [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md), and [docs/data-room/INDEX.md](docs/data-room/INDEX.md).

## License

First-party public code is Apache-2.0. It includes the contributor patent license and patent-litigation termination mechanism within Apache-2.0 section 3; it is not a blanket patent or non-infringement guarantee. Generated verifier files retain GPL-3.0 and vendored dependencies retain their original licenses. See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and [NOTICE](NOTICE).
