# ILAL version and evidence matrix

Status date: 2026-09-25

ILAL contains four protocol lines with different wire formats, deployment
histories and evidence. They must not be presented as one deployed system.
Only the deployment index can mark a public deployment as active. A candidate
manifest records reproducible evidence, but does not make that candidate the
active release or production-ready.

| Line | Purpose | Software status | Public chain status | Authorization | Execution | Compatibility |
| --- | --- | --- | --- | --- | --- | --- |
| v0.3.3 | Stable Session/CNF demo | Stable release; unaudited | Active Base Sepolia demo | CNF plus signed Session | Single v4 swap and controlled liquidity | Legacy v1 wire format |
| V2 policy-grant PoC | Private tier and jurisdiction policy proof | Candidate; development ceremony | Separate Base Sepolia candidate | Groth16 policy grant | Single v4 path through `ComplianceHookV2` | Does not authorize Hookathon SOEE |
| Hookathon SOEE | Atomic signed-order netting | Candidate; unaudited | Separate Base Sepolia candidate with exact-match source evidence | V1 CNF checks | Canonical batch netting and residual v4 swap | Does not consume V2 grants |
| Mixed v1 | Unified CNF/ZK grants, atomic execution and controlled LP | Implementation candidate; unaudited | Separate Base Sepolia CNF_ONLY testnet PoC candidate | Per-pool `CNF_ONLY`, `ZK_ONLY`, `EITHER` or `BOTH` | Batch, direct swap, isolated LP add/exit/collect | New domains, types, nonces, grants and positions |

## Evidence boundaries

### v0.3.3 active demo

- Deployment authority: [`deployments/index.json`](../deployments/index.json)
  and [`deployments/base-sepolia/v0.3.3.json`](../deployments/base-sepolia/v0.3.3.json).
- Package authority: [`RELEASE.md`](../RELEASE.md) and the matching release
  manifest.
- This is the only line that may be called the active Base Sepolia deployment.
- `active` and `stable` describe repository release state. They do not mean
  audited, mainnet-ready or suitable for production capital.

### V2 policy-grant candidate

- Deployment evidence:
  [`deployments/base-sepolia/v0.4.0-v2-poc.1.json`](../deployments/base-sepolia/v0.4.0-v2-poc.1.json).
- The candidate uses mock assets, a deployer-administered testnet configuration
  and an unsafe development Groth16 ceremony.
- Its grants are not accepted by the Hookathon netting contracts.

### Hookathon SOEE candidate

- Deployment and transaction evidence:
  [`docs/hookathon/chainlink-candidate-manifest.json`](hookathon/chainlink-candidate-manifest.json).
- The 82.35% figure is AMM input compression for the recorded 100/70 parity
  example. It is not a general user-return or profitability claim.
- Chainlink is a fail-closed opening guard in this candidate; it is not the
  execution price.

### Mixed v1 testnet candidate

- Executable behavior: [`docs/mixed/SPEC.md`](mixed/SPEC.md).
- Review boundary: [`docs/mixed/AUDIT_SCOPE.md`](mixed/AUDIT_SCOPE.md).
- Migration boundary: [`docs/mixed/MIGRATION.md`](mixed/MIGRATION.md).
- Deployment evidence:
  [`deployments/base-sepolia/v1.0.0-mixed-testnet.1.json`](../deployments/base-sepolia/v1.0.0-mixed-testnet.1.json).
- Mixed v1 integrates the product architecture in source, local end-to-end
  tests and a separate CNF_ONLY Base Sepolia pool. No published Mixed package,
  independent audit, production ceremony or real-issuer acceptance is claimed.
- The candidate uses Circle test USDC and ILAL hUSDT, which is not official
  USDT. ZK is disabled for this pool and the referenced verifier remains a
  development dependency.
- Legacy orders, grants, nonces, positions and signatures cannot be converted
  or replayed into Mixed v1.

## What each evidence type proves

| Evidence | Supports | Does not support |
| --- | --- | --- |
| Local tests | Behavior under the tested code and fixtures | Live deployment, audit or economic viability |
| Candidate manifest | Addresses, transactions and configuration for that candidate | Active-release status or compatibility with another line |
| Exact-match source verification | Deployed bytecode corresponds to submitted source metadata | Correctness, safe governance or production readiness |
| Development proof artifacts | Circuit integration and adversarial test execution | Production trusted setup or real credential lifecycle acceptance |
| Economic benchmark | Results for its stated state, fees, gas and order set | Universal savings or a promise of positive net user value |

## Source-of-truth order

When descriptions conflict, use:

1. Contract and TypeScript source for behavior.
2. [`deployments/index.json`](../deployments/index.json) for the active public
   deployment, then the referenced manifest.
3. The exact candidate manifest for candidate chain evidence.
4. Release manifests and [`RELEASE.md`](../RELEASE.md) for package status.
5. This matrix and current specifications for navigation.
6. Dated audit and research documents as historical evidence.

Changing one line does not update another. Any later Mixed deployment must add
a new versioned manifest and release record; it must not overwrite v0.3.3 or
reuse V2/Hookathon evidence.
