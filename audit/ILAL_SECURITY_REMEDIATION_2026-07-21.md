# ILAL Security Remediation Status

Date: 2026-07-21  
Source finding: `ILAL 深度安全审计报告`  
Scope: canonical `contracts/`, `circuits/`, and `cli/` implementation

Release target: local `@ilalv3/cli@0.3.0` candidate. This version is not
published and is not compatible with the currently deployed Router ABI.

## Executive Status

The application-level P0 findings identified in the deep review have been
remediated in source and covered by regression tests. The Solidity suite now
passes 164 Solidity tests with zero failures. The CLI security suite passes
15 tests and the SDK passes 15. These changes are not active on an
existing deployment until the full Base Sepolia stack is redeployed and the
CLI preset is updated.

ILAL is still not mainnet-ready. A production Phase-2 ceremony, multisig
ownership, independent external audit, and deployment verification remain
hard launch gates.

## Finding Disposition

| Finding | Status | Remediation / Evidence |
|---|---|---|
| C-01 development Groth16 setup | Operationally blocked | `circuits/scripts/compile.sh` now refuses the known zero beacon unless `ILAL_UNSAFE_DEV_CEREMONY=1` is explicitly set. It prints artifact SHA-256 values. A real ceremony has not yet occurred. |
| H-01 cross-issuer policy takeover | Fixed in source | Self-service policy writes may claim an unowned pool or update the current issuer's pool only. Disabled policies retain ownership. Owner-only migration remains available. Three takeover/migration regressions added. |
| H-02 source expiry detached from CNF | Fixed in source | EAS and ZK issuance cap CNF expiry to the source expiry. EAS-backed validity also follows live upstream revocation, expiry, schema, attester, and recipient state. |
| H-03 instant/optional ZK domain binding | Fixed in source | Issuer/schema changes use a 72-hour propose/activate flow exposed as `ilal oracle propose-domain` / `activate-domain`. Staged deployment is allowed, but ZK mint/renew fail closed until both hashes are nonzero, then require exact matches. Zero domain, verifier, and root proposals are rejected. |
| H-04 CLI command injection | Fixed in source | `forge` and proof tools are executed with `execFileSync` argument arrays. RPC URLs and paths no longer pass through a command shell. |
| H-04 proving artifact integrity | Fixed in source | Hosted zkey, vkey, WASM, and witness JavaScript are checked against a pinned SHA-256 manifest before execution. Downloads use a verified temporary file and atomic rename. Explicit `--circuit-dir` remains a user-trusted local override. |
| L-02b private key in argv | Fixed in CLI | Public Commander commands no longer expose `-k/--private-key`; signing keys are read from `PRIVATE_KEY`, avoiding routine leakage through process arguments and shell history. |
| M-01 default swap slippage | Fixed at CLI boundary | Live CLI swaps require a positive raw `--min-amount-out`. Test environments must explicitly opt out with `--unsafe-no-slippage`, which prints a warning. The contract still supports zero for low-level integrations. |
| M-02 fee based on requested input | Fixed in source | Router settles the swap first and charges protocol fee on actual input consumed. Partial-fill regression test added. |
| L-02a excessive approvals / LP bounds | Fixed in source + CLI | Swap approval is the exact conservative debit instead of 10x. Add-liquidity takes contract-enforced `maxAmount0/1`; remove-liquidity takes `minAmount0/1`. CLI requires explicit bounds and caps approvals to the add maxima unless an unsafe test-only flag is supplied. |
| L-02e zero Merkle root proposal | Fixed in source | New root proposals reject zero. |
| O-01 deployer retains admin ownership | Fixed in deployment path | Base mainnet `--broadcast` now requires `--admin <Safe>`. The CLI passes `ADMIN` to Foundry; the production script transfers `CNFIssuer` and `PolicyRegistry` ownership and asserts both final owners before completing. Safe threshold, signers, and monitoring remain operator responsibilities. |
| O-02 production deploy hardcodes Coinbase trust domain | Fixed in CLI | Production deploy accepts issuer-controlled `--eas`, `--schema`, `--attester`, metadata, treasury, and fee parameters. Defaults remain Coinbase for the standard path; custom issuer deployments no longer require editing source. |
| S-01 vulnerable CLI transitive dependency | Fixed in lockfile | `brace-expansion` was raised from vulnerable `2.1.1` to `2.1.2`; `npm audit --omit=dev` reports zero CLI production vulnerabilities. SDK production dependencies also report zero. |
| S-02 circuit build dependency advisories | Runtime set clean; build-tool risk remains | `circomlibjs` is correctly classified as a development-only proof-fixture dependency. `npm audit --omit=dev` is zero for circuits, while the full offline build tree still reports 21 advisories. Ceremony/proving builds must remain isolated and keyless until dependencies are replaced or reviewed. |
| Z-01 v1 issuer/schema values are not circuit-constrained | Isolated v2 candidate implemented; not live | `circuits/v2/ilal_policy.circom` binds issuer and schema into both the credential leaf and policy commitment. Cross-domain, low-tier, wrong-jurisdiction, and modified-policy witnesses are rejected. The v1 verifier and live deployment are unchanged. |
| Z-02 no pool-specific private tier/jurisdiction proof | Isolated v2 candidate implemented; not live | v2 proves private tier >= public pool minimum and private country membership in a jurisdiction root. `PolicyGrantManagerV2` caches a bounded per-wallet/per-pool grant; policy revisions and wallet revocations invalidate it. A v2 Hook integration and audit remain open. |

## Verification Performed

```text
forge test --summary
  CNFIssuerTest       59 passed
  ComplianceHookTest  29 passed
  FuzzCNFIssuer        9 passed (256 runs per fuzz case)
  Groth16AdapterV2      4 passed
  ILALRouterTest      28 passed
  PolicyGrantV2       15 passed
  PolicyRegistryTest  20 passed
  Total              164 passed, 0 failed

cd cli && npm test
  15 CLI security contract tests passed

cd sdk && npm test -- --run
  15 SDK tests passed

bash -n circuits/scripts/compile.sh
  Shell syntax passed

bash circuits/scripts/compile.sh
  Refuses to run without a ceremony beacon or explicit unsafe-dev override

cd circuits && npm run test:oracle
  7 Merkle input validation tests passed

cd circuits && npm run test:v2
  1 valid witness accepted; 4 adversarial witnesses rejected
  256,308 constraints; 9 public inputs
```

## Mainnet Launch Gates Still Open

1. Run and publish a real Phase-2 ceremony. Publish transcript, participant
   attestations, public beacon provenance, zkey/vkey/WASM hashes, and verifier
   bytecode hash.
2. Transfer `CNFIssuer` and `PolicyRegistry` ownership to documented Safe
   addresses. Configure monitoring for every proposal and activation event.
3. Decide whether to ship v1 membership credentials or complete the v2 policy
   grant path. v2 has an isolated circuit, registry, grant manager, adapter, and
   tests, but is not connected to a Hook and has no production verifier.
4. Document ZK proof reuse semantics. Reusing a proof cannot mint a second CNF
   and cannot extend beyond the proof expiry; a nullifier is required only if
   product policy demands one-time proof consumption.
5. Complete an independent audit and remediation review. Internal tests and
   testnet adversarial exercises are not a substitute for a production audit.
6. Redeploy the complete stack, update CLI/site presets, and repeat the full
   institutional plus adversarial acceptance suite against the new bytecode.

## Deployment Warning

The currently published Base Sepolia addresses predate this remediation batch.
Do not claim these fixes are live on-chain until a new deployment has been
verified by bytecode, configuration reads, successful compliant flows, and
blocked adversarial flows.

The required order is: deploy contracts, verify the new Router and Hook,
update `.ilal.json` and website presets, rerun acceptance tests, and only then
publish `@ilalv3/cli@0.3.0`.
