# ILAL code guide

The maintained implementation is `contracts/src/mixed/`. `protocol.json` selects its candidate deployment; historical deployment/release manifests remain unchanged.

| Concern | Entry |
| --- | --- |
| Signed types, domains and nonce namespaces | `MixedTypes.sol`, `MixedAuthorization.sol`, `sdk/src/mixed/types.ts` |
| Eligibility policy and short-lived grants | `MixedPolicyRegistry.sol`, `MixedGrantManager.sol` |
| Canonical atomic execution | `MixedExecutionRouter.sol`, `MixedHook.sol`, `MixedSettlement.sol` |
| Matching and rounding | `MatchingMath.sol`, `sdk/src/mixed/model.ts` |
| Owner-isolated liquidity | `MixedLiquidityRouter.sol` and Hook LP callbacks |
| Price and liveness guards | `MixedOracleGuard.sol`, `contracts/src/oracle/` |
| Shared CNF credentials | `contracts/src/CNFIssuer.sol` |
| Shared ZK policy circuit | `circuits/v2/ilal_policy.circom`, `contracts/src/v2/Groth16VerifierAdapterV2.sol` |
| Client operations | `sdk/src/mixed/client.ts` |
| CLI | `cli/src/index.ts`, `cli/src/commands/mixed.ts` |
| Wallet console | `cli/src/commands/mixedConsole.ts`, `site/mixed.*` |
| Deployment tooling | `scripts/mixed/` |

`Mixed` and circuit `V2` names are compatibility identifiers, not selectable products.

Execution: orders are canonically sorted, one PoolManager unlock opens settlement, the Hook validates current grants and signed limits, matched amounts are accounted internally, residual swaps execute, and outputs return to users atomically. Quote simulation always reverts. LP exit and collection require owner authorization but no current grant or healthy oracle.

When changing signed types, update Solidity, SDK encoders and ABI artifacts together. Preserve independent nonce namespaces, live credential/root/revision checks, full settlement rollback, owner-scoped LP salts and signed amount bounds.

Run `make verify` before handoff. This includes real proofs, Solidity/TypeScript differential tests, 100,000 invariant calls, isolated Anvil execution and wallet-console integration, package installation and secret scanning. Historical tests and benchmarks are reproducible from [the historical checkout](HISTORY.md).
