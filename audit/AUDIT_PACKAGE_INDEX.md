# ILAL Audit Package Index

This folder contains the materials to send with a formal audit request.

For the current review scope, start with:

- `ILAL_CURRENT_AUDIT_SCOPE.md`
- `../RELEASE.md`
- `../docs/CODEBASE_GUIDE.md`

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
- `contracts/test/ComplianceHookV2.t.sol`
- `contracts/test/PolicyGrantManagerV2.t.sol`
- `contracts/test/Groth16VerifierAdapterV2.t.sol`

## Active Base Sepolia Evidence

The source of truth is `../deployments/index.json` and the active manifest it
references. The current active entry is the v0.3.3 Safe-controlled MockEAS demo.

| Flow | Transaction |
|---|---|
| MockEAS attestation | `0x729f34c5ff27f355ac712d6bf5fb1dfce1f71952725b16f0c131f70c9357ade6` |
| CNF mint | `0xaaea4d6b00b84796949d7a0646e08d268a207ca09adb55323c748e052fe0b428` |
| Add liquidity | `0x8109f8677bbbef1c68ea4415e508215401a7e5a5969f315c02cc8e6b7db0ee0f` |
| Successful swap | `0x50215347045552e82993f164472d4c575850a254b384381c6bb502565916b7a5` |
| Invalid-credential swap | `0x72896278739b641eda1b5f709a028d53c129aeb3ee0478bee77d73a7969b356f` (reverted as expected) |
| Router binding | `ComplianceHook.authorizedRouter() = 0x2ccd398F6F60A1d926374a78F25e90E3Bef99A77` |

## Commands Run

```bash
cd contracts
forge test --summary
forge coverage --summary

cd ../cli
npm run build
```

Latest local results:

- Solidity tests: 188 passed, 0 failed, 0 skipped.
- CLI tests: 29 passed, 0 failed.
- SDK tests: 18 passed, 0 failed.
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
