# ILAL Mixed v1 local runbook

Mixed v1 combines atomic matching, bounded residual swaps, Mixed eligibility and owner-isolated liquidity. It currently has no public deployment. All commands below operate locally unless an explicit RPC and reviewed manifest are supplied.

## Verification

```bash
make mixed-verify
make mixed-local
```

`mixed-verify` regenerates two real development Groth16 proofs, checks Solidity/TypeScript vectors, executes the Mixed suites, runs 100,000 stateful handler calls, checks generated ABI drift and rejects deployed bytecode above EIP-170. `mixed-local` owns an ephemeral Anvil process, deploys a local fixture, exercises the SDK and browser protocol, runs four policy modes, root retirement, owner exit/collect and the economic matrix, then stops that process.

Generated evidence is under `artifacts/mixed/` and is intentionally ignored by git. Development proving artifacts and local manifests must never be presented as production evidence.

## CLI and Console

```bash
node cli/dist/index.js mixed check --manifest <manifest.json> --rpc <explicit-rpc>
node cli/dist/index.js mixed monitor --manifest <manifest.json> --rpc <explicit-rpc>
node cli/dist/index.js mixed quote --manifest <manifest.json> --rpc <explicit-rpc> --input unsigned-orders.json
node cli/dist/index.js mixed console --manifest <manifest.json> --rpc <explicit-rpc>
```

The workflow is grant activation, explicit ERC-20 approval, bounded order signing, forced-revert quote, fresh simulation and execution. An order signature never grants token spending permission. Direct swaps require a `MixedDirectSwap` signature and namespace; batch orders are not reused as fallback orders.

The Console binds to loopback, uses a random session token, rejects foreign Host/Origin values and delegates all signing and sending to the injected wallet. It does not hold keys or send notifications.

## Deployment preparation

`scripts/mixed/prepare-deployment.mjs` validates an explicit configuration and writes ordered unsigned transaction data. It has no broadcaster or signer. Production classification fails closed unless source, external runtime hashes, proving ceremony, issuer acceptance and independent audit evidence are supplied. `scripts/mixed/preflight.mjs` performs read-only post-deployment checks for code and immutable bindings, Hook flags, feeds, thresholds, sequencer, policy, roles, verifier and current oracle health.

The reviewed deployer must still simulate and approve the concrete plan. No deployment was created by this implementation.
