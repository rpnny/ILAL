# ILAL Audit Package Index

This folder contains the materials to send with a formal audit request.

For the current review scope, start with:

- `ILAL_CURRENT_AUDIT_SCOPE.md`
- `../RELEASE.md`

The older `v0.2.5` filenames are retained as supporting history and should not be treated as the only current version marker.

## Documents

| File | Purpose |
|---|---|
| `ILAL_CURRENT_AUDIT_SCOPE.md` | Current source, package, deployment, and mainnet-open-item scope. |
| `ILAL_ENTERPRISE_CYBERSECURITY_TEST_PLAN.md` | Highest-realism customer and adversarial cybersecurity test matrix. |
| `ILAL_v0.2.5_AUDIT_READINESS.md` | Security checklist with status, evidence, and open mainnet items. |
| `ILAL_ARCHITECTURE_ONE_PAGER.md` | One-page protocol architecture and flow explanation. |
| `ILAL_DESIGN_DECISIONS.md` | Design decisions and assumptions for auditors. |
| `ILAL_COVERAGE_SUMMARY.md` | Foundry coverage and test-count summary. |
| `ILAL_FULL_TEST_CHECKLIST.md` | Product, customer, and adversarial acceptance checklist. |
| `ILAL_v0.2.5_CUSTOMER_FINDING_TRIAGE.md` | Triage of legacy/v3 customer-reported issues against current v0.2.5 contracts. |

## Source Scope

Primary contracts:

- `contracts/src/ComplianceHook.sol`
- `contracts/src/CNFIssuer.sol`
- `contracts/src/PolicyRegistry.sol`
- `contracts/src/ILALRouter.sol`
- `contracts/src/libraries/SessionLib.sol`
- `contracts/src/verifier/Groth16VerifierAdapter.sol`
- `contracts/src/verifier/ILALVerifier.sol`

Test suites:

- `contracts/test/ComplianceHook.t.sol`
- `contracts/test/CNFIssuer.t.sol`
- `contracts/test/PolicyRegistry.t.sol`
- `contracts/test/ILALRouter.t.sol`
- `contracts/test/Fuzz.t.sol`

## Base Sepolia Live Evidence

| Flow | Transaction |
|---|---|
| ZK CNF mint | `0xb9aa16c9604a575c8b2281cbfe9ba24fedbf205283a7b05638fbc413ed78de41` |
| Add liquidity | `0x8b2b87ca74debf9988e09ee06dccdd3ff73d759a4c5508f36cf53b0c4af12d33` |
| Swap | `0xb67dc74b85d40ef23c16e925b33e5959b9f3d467c5c2e06fe3a43f17ce18ddd5` |
| Safe LP exit | `0xc1f80cef49d0d256c616d5c567181958592f13a1a32d8af2e3eb2a6870cfe826` |
| Router binding | `ComplianceHook.authorizedRouter() = 0x805A7654bDCfF1286652de29D2aE906a87e2a912` |

## Commands Run

```bash
cd contracts
forge test --summary
forge coverage --summary

cd ../cli
npm run build
```

Latest local results:

- Solidity tests: 164 passed, 0 failed.
- CLI security contract tests: 15 passed, 0 failed.
- SDK tests: 15 passed, 0 failed.
- Circuit oracle validation tests: 7 passed, 0 failed.
- Isolated policy circuit v2: 1 valid vector accepted and 4 adversarial vectors rejected.
- CLI TypeScript build: passed.
- Coverage report: generated, see `ILAL_COVERAGE_SUMMARY.md`.

## Known Mainnet Open Items

- Transfer admin ownership to multisig/timelock.
- Publish trusted setup ceremony and verifier artifact hashes.
- Replace the development-only Phase 2 beacon with a production ceremony or auditor-approved artifact process.
- Decide whether repeated proof renewal should remain allowed or add explicit nullifier tracking.
- Increase router branch coverage around settlement and ERC-20 edge cases.
- Pin Solidity pragmas exactly if requested by the audit firm.
