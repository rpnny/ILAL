# ILAL coverage snapshot

> Coverage percentages below were measured for the v0.3.0 release candidate
> on 2026-07-21. They are retained as historical evidence and must not be
> presented as fresh v0.3.3 coverage. Current test results are recorded
> separately below.

Command:

```bash
cd contracts
forge coverage --summary
```

Result date: 2026-07-21

## Core Contract Coverage

| File | Lines | Statements | Branches | Functions |
|---|---:|---:|---:|---:|
| `src/CNFIssuer.sol` | 98.74% | 98.04% | 90.91% | 100.00% |
| `src/ComplianceHook.sol` | 81.08% | 91.30% | 95.00% | 56.25% |
| `src/ILALRouter.sol` | 95.65% | 93.28% | 78.57% | 100.00% |
| `src/PolicyRegistry.sol` | 100.00% | 100.00% | 100.00% | 100.00% |
| `src/libraries/SessionLib.sol` | 88.24% | 81.82% | 33.33% | 75.00% |

## Current test results

`forge test --summary`:

| Suite | Passed | Failed |
|---|---:|---:|
| `CNFIssuerTest` | 59 | 0 |
| `ComplianceHookTest` | 29 | 0 |
| `ComplianceHookV2Test` | 21 | 0 |
| `FuzzCNFIssuer` | 9 | 0 |
| `Groth16VerifierAdapterV2Test` | 4 | 0 |
| `ILALRouterTest` | 31 | 0 |
| `PolicyGrantManagerV2Test` | 15 | 0 |
| `PolicyRegistryTest` | 20 | 0 |
| Total | 188 | 0 |

## Notes for Auditors

- Foundry's total coverage is lower because it includes deployment scripts, generated verifier code, mocks, and test helpers.
- The generated Groth16 verifier is not meaningfully unit-covered by Foundry line coverage; it should be reviewed through circuit/verifier artifact review, known verifier template review, and live proof verification evidence.
- `ComplianceHook` function coverage is low because inactive hook methods intentionally revert `NotImplemented`; active hook paths are tested.
- `ILALRouter` now covers swap slippage, partial-fill fees, caller-scoped LP positions, and LP amount limits. Branch coverage should still expand before mainnet around failed/non-standard ERC-20 settlement behavior.
