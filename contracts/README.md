# ILAL contracts

One maintained ILAL v1 execution stack lives under `src/mixed/`: grants, canonical order netting, direct swaps and owner-isolated LP positions. The directory and `Mixed*` contract names are compatibility identifiers for the deployed wire format.

Shared infrastructure remains in place: `CNFIssuer.sol`, interfaces, `oracle/ChainlinkStablecoinOracleGuard.sol`, `libraries/HookMiner.sol`, and the policy circuit's `v2/Groth16VerifierAdapterV2.sol` / `verifier/ILALPolicyVerifierV2.sol`. These are dependencies of the unified protocol, not separate product versions. Existing source names and on-chain domains are preserved.

```bash
./scripts/install-deps.sh
forge build
forge test
```

From the repository root, `make protocol-test` adds real-proof/differential tests and 100,000 stateful invariant calls. `make local-test` also runs the isolated Anvil lifecycle, economics and console integration.

Use `scripts/mixed/` for deployment planning and preflight. The old independent Session, V2 and Hookathon routers/hooks and their deployment scripts have been removed; historical source is recoverable as documented in [HISTORY.md](../docs/HISTORY.md).

The Base Sepolia candidate is unaudited and not production-ready. See [the specification](../docs/mixed/SPEC.md) and [audit scope](../docs/mixed/AUDIT_SCOPE.md).
